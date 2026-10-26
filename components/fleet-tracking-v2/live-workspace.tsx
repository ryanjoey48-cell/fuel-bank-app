"use client";

import Link from "next/link";
import { Activity, Clock3, Gauge, MapPin, MapPinned, RefreshCw, Search, Truck, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useLanguage } from "@/lib/language-provider";
import { getPortalVehicleTypeLabel } from "@/lib/driver-vehicle-types";
import { adaptForthFleetResponse, attachUniqueActiveDriverAssignments, canOpenVerifiedGoogleMaps, matchesLiveVehicleSearch, type FleetTrackingV2LiveVehicle, type LiveEesVehicleIdentity } from "@/lib/fleet-tracking-v2/live-adapter";
import { canFocusVehicle, canShowUnverifiedReportedPosition, formatReportTime, getMotionState, type MotionState } from "@/lib/fleet-tracking-v2/view";
import { summarizeLiveFleet } from "@/lib/fleet-tracking-v2/summary";
import { FLEET_TRACKING_V2_COPY } from "@/lib/fleet-tracking-v2/copy";
import { FleetTrackingV2Map } from "./fleet-map";
import styles from "./live-workspace.module.css";

type Language = "en" | "th";
type Filter = "all" | "moving" | "stopped" | "unknown";
type Command = { type: "fit" | "focus"; sequence: number; key?: string | null };
type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; records: FleetTrackingV2LiveVehicle[]; fetchedAt: string | null; vehicleRegistryAvailable: boolean };

const LIVE_COPY = {
  en: {
    eyebrow: "LIVE FLEET DATA · READ ONLY", title: "Fleet Tracking Centre",
    sourceNote: "Existing protected Forth feed · manual refresh only · no background polling.",
    fixtureLink: "Open labelled development fixture", returned: "Forth records", activity: "Activity reported", positionSummary: "GPS positions",
    activityUnavailable: "Unavailable", verified: "GPS verified", fetched: "Feed fetched", loading: "Loading protected fleet data…",
    errorTitle: "Live fleet data is unavailable",
    errorHelp: "No simulated readings are shown. Check office access and the Forth Preview configuration, then retry.",
    retry: "Retry", refresh: "Refresh live data", search: "Search registration, device, driver or address",
    roster: "Vehicle roster", all: "All", moving: "Moving", stopped: "Stopped", unknown: "Unavailable",
    noRecords: "Forth returned no vehicle records.", noResults: "No vehicles match this search.",
    registrationUnavailable: "Registration unavailable", locationUnavailable: "Location unavailable",
    speed: "Source speed", engine: "Engine", engineOn: "On", engineOff: "Off", engineUnknown: "Unknown",
    movement: "Reported activity", driving: "Driving", uncertain: "Uncertain",
    stoppedEngineOn: "Stopped · engine on", stoppedEngineOff: "Stopped · engine off",
    stoppedEngineUnknown: "Stopped · engine unknown", activityUnavailableLabel: "Activity unavailable",
    location: "Location", tracker: "Tracker connection", trackerConnected: "Connected",
    trackerDisconnected: "Disconnected", trackerUnknown: "Unknown",
    gpsConfidenceLabel: "GPS confidence", gpsVerifiedLabel: "GPS position verified", gpsUnverified: "GPS position not verified",
    gpsConfidenceUnavailable: "GPS confidence unavailable", timezoneUnknown: "Source timezone unknown",
    stale: "Position report is stale", sourceTimestamp: "Last source report", rawTimestamp: "Original source time",
    noSourceTime: "No interpretable source time", gpsReceiver: "GPS receiver", positionQuality: "Position quality",
    positionSource: "Position source", coordinates: "Source coordinates", identity: "EES vehicle identity",
    identityMatched: "Matched", identityAmbiguous: "Ambiguous · not linked", identityUnmatched: "No unique EES match",
    identityUnavailable: "EES vehicle roster unavailable", identityReason: "Match status",
    reportedDriver: "Forth-reported driver", noDriver: "No driver reported", technical: "Technical details",
    closeDetails: "Close details", fitArea: "Fit fleet", showRoster: "Show roster", hideRoster: "Hide roster",
    clusterTitle: "Vehicles at this map point",
    clusterHint: "Select a registration to open details. Original coordinates are unchanged.",
    chooseVehicle: "Select", gpsIssue: "GPS not verified", sourceStale: "Stale report",
    signIn: "A verified office sign-in is required.", requestFailed: "The tracking request failed.",
    unavailableGps: "No verified GPS positions are currently available.",
    currentShort: "Current report", staleShort: "Stale report", timeUnknownShort: "Time unknown", timeUnavailableShort: "No source time",
    gpsVerifiedShort: "GPS verified", gpsUnverifiedShort: "GPS unverified", gpsUnknownShort: "GPS unknown",
    reportFreshnessLabel: "Report freshness",
    mapLegend: "Map legend", verifiedMarker: "Verified GPS", reportedMarker: "Unverified reported position",
    showUnverified: "Show unverified reported positions",
    lastReportedPosition: "Last reported position · unverified", positionNotVerified: "Position not verified",
    verifiedPosition: "Verified GPS position",
    unverifiedPositionWarning: "This is the last position reported by Forth. It is not verified and may be outdated or inaccurate. Do not treat it as current.",
    verifiedPositionNote: "GPS is verified from a current source report.", coordinatesUnavailable: "Reported coordinates unavailable.",
    openGoogleMaps: "Open verified position in Google Maps", vehicleModel: "Vehicle model", vehicleType: "Vehicle type",
    assignedDriver: "Confirmed EES driver", noUniqueAssignment: "No unique active EES assignment",
    noDriverAssignment: "No active EES driver assignment", assignmentUnavailable: "EES driver assignment unavailable",
    sourceRegistration: "Forth-reported registration", forthReportedDriver: "Forth-reported driver",
    vehicleTypeRaw: "Raw EES vehicle type", vehicleCategoryRaw: "Raw EES vehicle category",
    metricsRecords: "Forth records", metricsActivity: "Activity reported", metricsGps: "GPS confidence", metricsReports: "Source reports",
    movingShort: "moving", stoppedShort: "stopped", uncertainShort: "uncertain", unavailableShort: "unavailable",
    verifiedShort: "verified", unverifiedCount: "unverified", confidenceUnknownShort: "confidence unknown",
    reportsCurrent: "current", reportsStale: "stale", reportsUnknown: "time unknown", summaryUnavailable: "Data unavailable",
    noConfirmedIdentity: "No confirmed EES match", emptyInspectorTitle: "Select a vehicle",
    emptyInspectorBody: "Choose any registration from the roster or map to inspect its latest Forth report.",
    journeyHistory: "Journey history", parkingHistory: "Parking history",
    historyUnavailable: "History is unavailable until its Forth request contract and permissions are verified. No history request is made here.",
    mapsUnavailable: "Google Maps is available only for a fresh, verified GPS position.",
    showLastReported: "Show last reported position on map", reportedPositionShown: "Unverified reported position is shown on the map.",
    mapTitle: "Fleet map", searchGroup: "Search registrations in this group", noGroupMatches: "No registrations match this search.",
    rosterHint: "Search and select any returned vehicle", identityConfirmed: "Confirmed EES vehicle",
    detailsActions: "Vehicle actions", device: "Forth device ID", googleMaps: "Google Maps"
  },
  th: {
    eyebrow: "ข้อมูลรถจริง · อ่านอย่างเดียว", title: "ศูนย์ติดตามรถ",
    sourceNote: "ใช้ข้อมูล Forth ผ่าน API ที่มีการป้องกัน · รีเฟรชเองเท่านั้น · ไม่มีการดึงข้อมูลเบื้องหลัง",
    fixtureLink: "เปิดชุดข้อมูลจำลองสำหรับพัฒนา", returned: "รายการจาก Forth", activity: "สถานะการใช้งาน", positionSummary: "ตำแหน่ง GPS",
    activityUnavailable: "ไม่พร้อมใช้งาน", verified: "ตำแหน่ง GPS ยืนยันแล้ว", fetched: "ดึงข้อมูลเมื่อ", loading: "กำลังโหลดข้อมูลรถ…",
    errorTitle: "ไม่สามารถใช้งานข้อมูลรถจริงได้",
    errorHelp: "ไม่มีการแสดงข้อมูลจำลอง โปรดตรวจสอบสิทธิ์สำนักงานและการตั้งค่า Forth Preview แล้วลองอีกครั้ง",
    retry: "ลองอีกครั้ง", refresh: "รีเฟรชข้อมูลจริง", search: "ค้นหาทะเบียน อุปกรณ์ คนขับ หรือที่อยู่",
    roster: "รายชื่อรถ", all: "ทั้งหมด", moving: "กำลังเคลื่อนที่", stopped: "หยุด", unknown: "ไม่พร้อมใช้งาน",
    noRecords: "Forth ไม่ส่งรายการรถกลับมา", noResults: "ไม่พบรถที่ตรงกับการค้นหา",
    registrationUnavailable: "ไม่มีทะเบียนรถ", locationUnavailable: "ไม่มีข้อมูลสถานที่",
    speed: "ความเร็วจากอุปกรณ์", engine: "เครื่องยนต์", engineOn: "เปิด", engineOff: "ปิด", engineUnknown: "ไม่ทราบ",
    movement: "สถานะจากข้อมูล", driving: "กำลังขับ", uncertain: "ไม่แน่ชัด",
    stoppedEngineOn: "หยุด · เครื่องยนต์เปิด", stoppedEngineOff: "หยุด · เครื่องยนต์ปิด",
    stoppedEngineUnknown: "หยุด · ไม่ทราบสถานะเครื่องยนต์", activityUnavailableLabel: "สถานะไม่พร้อมใช้งาน",
    location: "สถานที่", tracker: "การเชื่อมต่ออุปกรณ์", trackerConnected: "เชื่อมต่อ",
    trackerDisconnected: "ขาดการเชื่อมต่อ", trackerUnknown: "ไม่ทราบ",
    gpsConfidenceLabel: "ความเชื่อมั่น GPS", gpsVerifiedLabel: "ยืนยันตำแหน่ง GPS แล้ว", gpsUnverified: "ยังไม่ยืนยันตำแหน่ง GPS",
    gpsConfidenceUnavailable: "ไม่สามารถประเมินความน่าเชื่อถือ GPS", timezoneUnknown: "ไม่ทราบเขตเวลาต้นทาง",
    stale: "ข้อมูลตำแหน่งเก่า", sourceTimestamp: "รายงานล่าสุดจากต้นทาง", rawTimestamp: "เวลาต้นฉบับ",
    noSourceTime: "ไม่มีเวลาต้นทางที่แปลผลได้", gpsReceiver: "การเชื่อมต่อ GPS", positionQuality: "คุณภาพตำแหน่ง",
    positionSource: "แหล่งตำแหน่ง", coordinates: "พิกัดต้นทาง", identity: "ข้อมูลรถใน EES",
    identityMatched: "จับคู่แล้ว", identityAmbiguous: "ไม่ชัดเจน · ยังไม่เชื่อมโยง",
    identityUnmatched: "ไม่มีรายการ EES ที่ไม่ซ้ำ", identityUnavailable: "ไม่มีรายชื่อรถ EES",
    identityReason: "สถานะการจับคู่", reportedDriver: "คนขับที่ Forth รายงาน", noDriver: "ไม่มีข้อมูลคนขับ",
    technical: "รายละเอียดทางเทคนิค", closeDetails: "ปิดรายละเอียด", fitArea: "แสดงรถทั้งหมด",
    showRoster: "แสดงรายชื่อ", hideRoster: "ซ่อนรายชื่อ", clusterTitle: "รถที่ตำแหน่งแผนที่นี้",
    clusterHint: "เลือกทะเบียนเพื่อดูรายละเอียด ระบบคงพิกัดเดิม", chooseVehicle: "เลือก",
    gpsIssue: "ยังไม่ยืนยัน GPS", sourceStale: "รายงานเก่า",
    signIn: "ต้องเข้าสู่ระบบสำนักงานที่ยืนยันแล้ว", requestFailed: "คำขอติดตามรถไม่สำเร็จ",
    unavailableGps: "ขณะนี้ไม่มีตำแหน่ง GPS ที่ยืนยันแล้ว",
    currentShort: "รายงานปัจจุบัน", staleShort: "รายงานเก่า", timeUnknownShort: "ไม่ทราบเวลา", timeUnavailableShort: "ไม่มีเวลาต้นทาง",
    gpsVerifiedShort: "ยืนยัน GPS", gpsUnverifiedShort: "ยังไม่ยืนยัน GPS", gpsUnknownShort: "ไม่ทราบ GPS",
    reportFreshnessLabel: "ความสดใหม่ของรายงาน",
    mapLegend: "สัญลักษณ์แผนที่", verifiedMarker: "ยืนยัน GPS แล้ว", reportedMarker: "ตำแหน่งรายงานที่ยังไม่ยืนยัน",
    showUnverified: "แสดงตำแหน่งรายงานที่ยังไม่ยืนยัน",
    lastReportedPosition: "ตำแหน่งรายงานล่าสุด · ยังไม่ยืนยัน", positionNotVerified: "ยังไม่ยืนยันตำแหน่ง",
    verifiedPosition: "ตำแหน่ง GPS ที่ยืนยันแล้ว",
    unverifiedPositionWarning: "นี่คือตำแหน่งล่าสุดที่ Forth รายงาน ยังไม่ได้ยืนยัน และอาจเก่าหรือคลาดเคลื่อน อย่าใช้เป็นตำแหน่งปัจจุบัน",
    verifiedPositionNote: "ยืนยัน GPS จากรายงานต้นทางปัจจุบันแล้ว", coordinatesUnavailable: "ไม่มีพิกัดที่รายงาน",
    openGoogleMaps: "เปิดตำแหน่งที่ยืนยันใน Google Maps", vehicleModel: "รุ่นรถ", vehicleType: "ประเภทรถ",
    assignedDriver: "คนขับ EES ที่ยืนยันแล้ว", noUniqueAssignment: "ไม่มีการมอบหมายคนขับที่ไม่ซ้ำ",
    noDriverAssignment: "ไม่มีการมอบหมายคนขับ EES ที่ยังใช้งาน", assignmentUnavailable: "ไม่มีข้อมูลการมอบหมายคนขับ EES",
    sourceRegistration: "ทะเบียนที่ Forth รายงาน", forthReportedDriver: "คนขับที่ Forth รายงาน",
    vehicleTypeRaw: "ประเภทรถ EES ดิบ", vehicleCategoryRaw: "หมวดรถ EES ดิบ",
    metricsRecords: "รายการจาก Forth", metricsActivity: "สถานะที่รายงาน", metricsGps: "ความเชื่อมั่น GPS", metricsReports: "รายงานต้นทาง",
    movingShort: "กำลังเคลื่อนที่", stoppedShort: "หยุด", uncertainShort: "ไม่แน่ชัด", unavailableShort: "ไม่พร้อมใช้งาน",
    verifiedShort: "ยืนยันแล้ว", unverifiedCount: "ยังไม่ยืนยัน", confidenceUnknownShort: "ไม่ทราบความเชื่อมั่น",
    reportsCurrent: "ปัจจุบัน", reportsStale: "เก่า", reportsUnknown: "ไม่ทราบเวลา", summaryUnavailable: "ข้อมูลไม่พร้อมใช้งาน",
    noConfirmedIdentity: "ไม่มีข้อมูลรถ EES ที่ยืนยันได้", emptyInspectorTitle: "เลือกรถ",
    emptyInspectorBody: "เลือกทะเบียนจากรายชื่อหรือแผนที่เพื่อดูรายงานล่าสุดจาก Forth",
    journeyHistory: "ประวัติการเดินทาง", parkingHistory: "ประวัติการจอด",
    historyUnavailable: "ยังไม่เปิดใช้จนกว่าจะยืนยันรูปแบบคำขอและสิทธิ์ Forth จะไม่มีการเรียกประวัติจากส่วนนี้",
    mapsUnavailable: "เปิด Google Maps ได้เมื่อมีตำแหน่ง GPS ที่ยืนยันและเป็นข้อมูลปัจจุบันเท่านั้น",
    showLastReported: "แสดงตำแหน่งรายงานล่าสุดบนแผนที่", reportedPositionShown: "กำลังแสดงตำแหน่งรายงานที่ยังไม่ยืนยันบนแผนที่",
    mapTitle: "แผนที่รถ", searchGroup: "ค้นหาทะเบียนในกลุ่มนี้", noGroupMatches: "ไม่พบทะเบียนที่ตรงกับการค้นหา",
    rosterHint: "ค้นหาและเลือกรถจากข้อมูลทั้งหมด", identityConfirmed: "ข้อมูลรถ EES ที่ยืนยันแล้ว",
    detailsActions: "การดำเนินการกับรถ", device: "รหัสอุปกรณ์ Forth", googleMaps: "Google Maps"
  }
} as const;

const activityKeys = {
  driving: "driving",
  uncertain: "uncertain",
  stopped_engine_on: "stoppedEngineOn",
  stopped_engine_off: "stoppedEngineOff",
  stopped_engine_unknown: "stoppedEngineUnknown",
  unavailable: "activityUnavailableLabel"
} as const;

function pillClass(state: MotionState) {
  if (state === "moving") return styles.pillMoving;
  if (state === "stopped") return styles.pillStopped;
  if (state === "offline") return styles.pillOffline;
  return styles.pillUnknown;
}

function activityLabel(vehicle: FleetTrackingV2LiveVehicle, copy: (typeof LIVE_COPY)[Language]) {
  return copy[activityKeys[vehicle.activity]];
}

function trackerLabel(vehicle: FleetTrackingV2LiveVehicle, copy: (typeof LIVE_COPY)[Language]) {
  if (vehicle.trackerConnectivity === "connected") return copy.trackerConnected;
  if (vehicle.trackerConnectivity === "disconnected") return copy.trackerDisconnected;
  return copy.trackerUnknown;
}

function confidenceLabel(vehicle: FleetTrackingV2LiveVehicle, copy: (typeof LIVE_COPY)[Language]) {
  if (vehicle.gpsConfidence === "verified") return copy.gpsVerifiedLabel;
  if (vehicle.gpsConfidence === "unavailable") return copy.gpsConfidenceUnavailable;
  return copy.gpsUnverified;
}

function rosterFreshnessLabel(vehicle: FleetTrackingV2LiveVehicle, copy: (typeof LIVE_COPY)[Language]) {
  if (vehicle.reportFreshness === "current") return copy.currentShort;
  if (vehicle.reportFreshness === "stale") return copy.staleShort;
  if (vehicle.reportFreshness.startsWith("timezone_")) return copy.timeUnknownShort;
  return copy.timeUnavailableShort;
}

function sourceTimeLabel(vehicle: FleetTrackingV2LiveVehicle, language: Language, copy: (typeof LIVE_COPY)[Language]) {
  if (vehicle.timestampStatus.startsWith("timezone_")) {
    return vehicle.sourceTimestampRaw ? copy.timezoneUnknown + " · " + vehicle.sourceTimestampRaw : copy.timezoneUnknown;
  }
  if (vehicle.reportedAt) return formatReportTime(vehicle.reportedAt, language) ?? copy.noSourceTime;
  return vehicle.sourceTimestampRaw ?? copy.noSourceTime;
}

function locationLabel(vehicle: FleetTrackingV2LiveVehicle, language: Language, copy: (typeof LIVE_COPY)[Language]) {
  const address = language === "th"
    ? vehicle.locationAddressThai ?? vehicle.locationAddressEnglish
    : vehicle.locationAddressEnglish ?? vehicle.locationAddressThai;
  return address ?? copy.locationUnavailable;
}

function engineLabel(vehicle: FleetTrackingV2LiveVehicle, copy: (typeof LIVE_COPY)[Language]) {
  if (vehicle.engineOn === true) return copy.engineOn;
  if (vehicle.engineOn === false) return copy.engineOff;
  return copy.engineUnknown;
}

function formatIdentityType(value: string | null, language: Language) {
  if (!value) return null;
  const knownLabel = getPortalVehicleTypeLabel(value, language);
  if (knownLabel) return knownLabel;
  return value.trim().split(/[_\s-]+/).filter(Boolean)
    .map((part) => part.charAt(0) + part.slice(1).toLocaleLowerCase())
    .join(" ");
}

function identitySummaryLabel(vehicle: FleetTrackingV2LiveVehicle, language: Language, copy: (typeof LIVE_COPY)[Language]) {
  if (vehicle.eesIdentity.status === "matched") {
    return [vehicle.eesIdentity.vehicleModel, formatIdentityType(vehicle.eesIdentity.vehicleType ?? vehicle.eesIdentity.vehicleCategory, language)]
      .filter((value): value is string => Boolean(value))
      .join(" · ") || copy.identityMatched;
  }
  if (vehicle.eesIdentity.status === "ambiguous") return copy.identityAmbiguous;
  if (vehicle.eesIdentity.status === "unmatched") return copy.identityUnmatched;
  return copy.identityUnavailable;
}

function confidenceTone(vehicle: FleetTrackingV2LiveVehicle) {
  if (vehicle.gpsConfidence === "verified") return styles.toneVerified;
  if (vehicle.gpsConfidence === "unverified") return styles.toneWarning;
  return styles.toneUnknown;
}

function freshnessTone(vehicle: FleetTrackingV2LiveVehicle) {
  if (vehicle.reportFreshness === "current") return styles.toneVerified;
  if (vehicle.reportFreshness === "stale") return styles.toneWarning;
  return styles.toneUnknown;
}

function VehicleDetails({ vehicle, language, copy, onClose, onShowReportedPosition, showUnverifiedPositions }: {
  vehicle: FleetTrackingV2LiveVehicle;
  language: Language;
  copy: (typeof LIVE_COPY)[Language];
  onClose: () => void;
  onShowReportedPosition: () => void;
  showUnverifiedPositions: boolean;
}) {
  const hasCoordinates = vehicle.coordinateStatus === "valid" &&
    typeof vehicle.latitude === "number" && Number.isFinite(vehicle.latitude) &&
    typeof vehicle.longitude === "number" && Number.isFinite(vehicle.longitude);
  const coordinates = hasCoordinates
    ? String(vehicle.latitude) + ", " + String(vehicle.longitude)
    : copy.coordinatesUnavailable;
  const verifiedFreshPosition = canOpenVerifiedGoogleMaps(vehicle);
  const positionTitle = verifiedFreshPosition
    ? copy.verifiedPosition
    : vehicle.gpsConfidence === "unverified" ? copy.lastReportedPosition : copy.positionNotVerified;
  const mapsUrl = verifiedFreshPosition
    ? "https://www.google.com/maps/search/?api=1&query=" +
      encodeURIComponent(String(vehicle.latitude) + "," + String(vehicle.longitude))
    : null;
  const driverAssignment = vehicle.eesIdentity.driverAssignmentStatus === "ambiguous"
    ? copy.noUniqueAssignment
    : vehicle.eesIdentity.driverAssignmentStatus === "unavailable"
      ? copy.assignmentUnavailable
      : copy.noDriverAssignment;
  const identitySummary = identitySummaryLabel(vehicle, language, copy);
  const vehicleTypeLabel = formatIdentityType(vehicle.eesIdentity.vehicleType ?? vehicle.eesIdentity.vehicleCategory, language);
  return (
    <aside className={styles.inspector} aria-labelledby="fleet-v2-live-details-title">
      <div className={styles.inspectorHeader}>
        <div className={styles.inspectorHeading}>
          <p className={styles.inspectorEyebrow}>{copy.identity}</p>
          <h2 id="fleet-v2-live-details-title">{vehicle.registration || copy.registrationUnavailable}</h2>
          <p className={styles.identityLine}>{identitySummary}</p>
        </div>
        <button type="button" className={styles.iconButton} onClick={onClose} aria-label={copy.closeDetails} title={copy.closeDetails}><X size={17} /></button>
      </div>

      {vehicle.eesIdentity.status === "matched" ? (
        <div className={styles.confirmedIdentity}>
          <span><strong>{copy.vehicleModel}</strong>{vehicle.eesIdentity.vehicleModel ?? "—"}</span>
          <span><strong>{copy.vehicleType}</strong>{vehicleTypeLabel ?? "—"}</span>
          <span className={styles.driverIdentity}><strong>{copy.assignedDriver}</strong>{vehicle.eesIdentity.assignedDriverName ?? driverAssignment}</span>
        </div>
      ) : <p className={styles.identityNotice}>{identitySummary}</p>}

      <div className={styles.operationalPills}>
        <span className={styles.activityPill + " " + pillClass(getMotionState(vehicle))}><Activity size={13} />{activityLabel(vehicle, copy)}</span>
        <span className={styles.statusPill + " " + (vehicle.trackerConnectivity === "connected" ? styles.toneVerified : vehicle.trackerConnectivity === "disconnected" ? styles.toneWarning : styles.toneUnknown)}>{trackerLabel(vehicle, copy)}</span>
        <span className={styles.statusPill + " " + freshnessTone(vehicle)}>{rosterFreshnessLabel(vehicle, copy)}</span>
      </div>

      <div className={styles.performanceGrid}>
        <div className={styles.performanceCard}>
          <span><Gauge size={14} />{copy.speed}</span>
          <strong>{typeof vehicle.speedKph === "number" ? <>{vehicle.speedKph}<small> km/h</small></> : "—"}</strong>
        </div>
        <div className={styles.performanceCard}>
          <span>{copy.engine}</span>
          <strong>{engineLabel(vehicle, copy)}</strong>
        </div>
      </div>

      <section className={styles.positionCard} aria-label={positionTitle}>
        <div className={styles.positionHeading}>
          <span className={styles.positionIcon}><MapPin size={15} /></span>
          <div className={styles.positionTitleBlock}>
            <strong>{copy.location}</strong>
            <span className={styles.positionAddress}>{locationLabel(vehicle, language, copy)}</span>
          </div>
          <span className={styles.confidenceBadge + " " + confidenceTone(vehicle)}>{confidenceLabel(vehicle, copy)}</span>
        </div>
        <div className={styles.positionMeta}>
          <div><span>{copy.sourceTimestamp}</span><strong>{sourceTimeLabel(vehicle, language, copy)}</strong></div>
          <div><span>{copy.reportFreshnessLabel}</span><strong className={freshnessTone(vehicle)}>{rosterFreshnessLabel(vehicle, copy)}</strong></div>
        </div>
        <p className={verifiedFreshPosition ? styles.positionVerifiedHint : styles.positionWarning}>
          {verifiedFreshPosition ? copy.verifiedPositionNote : copy.unverifiedPositionWarning}
        </p>
        {canShowUnverifiedReportedPosition(vehicle) && !showUnverifiedPositions ? (
          <button type="button" className={styles.showReportedButton} onClick={onShowReportedPosition}>{copy.showLastReported}</button>
        ) : null}
        {canShowUnverifiedReportedPosition(vehicle) && showUnverifiedPositions ? (
          <p className={styles.positionShown}>{copy.reportedPositionShown}</p>
        ) : null}
        {!hasCoordinates ? <p className={styles.coordinatesUnavailable}>{copy.coordinatesUnavailable}</p> : null}
      </section>

      <div className={styles.actions} aria-label={copy.detailsActions}>
        <button type="button" disabled title={copy.historyUnavailable}><Clock3 size={15} />{copy.journeyHistory}</button>
        <button type="button" disabled title={copy.historyUnavailable}><MapPin size={15} />{copy.parkingHistory}</button>
        {mapsUrl
          ? <a href={mapsUrl} target="_blank" rel="noreferrer"><MapPinned size={15} />{copy.openGoogleMaps}</a>
          : <button type="button" disabled title={copy.mapsUnavailable}><MapPinned size={15} />{copy.googleMaps}</button>}
      </div>
      <p className={styles.actionNote}>{copy.historyUnavailable}</p>

      <details className={styles.technical}>
        <summary>{copy.technical}</summary>
        <dl className={styles.technicalList}>
          <dt>{copy.tracker}</dt><dd>{trackerLabel(vehicle, copy)}</dd>
          <dt>{copy.gpsConfidenceLabel}</dt><dd>{confidenceLabel(vehicle, copy)} · {vehicle.gpsConfidenceReason}</dd>
          <dt>{copy.gpsReceiver}</dt><dd>{vehicle.gpsConnectivity}</dd>
          <dt>{copy.positionQuality}</dt><dd>{vehicle.positionQuality}</dd>
          <dt>{copy.positionSource}</dt><dd>{vehicle.positionSource ?? "—"}</dd>
          <dt>{copy.coordinates}</dt><dd>{hasCoordinates ? coordinates : copy.coordinatesUnavailable}</dd>
          <dt>{copy.rawTimestamp}</dt><dd>{vehicle.sourceTimestampRaw ?? "—"}</dd>
          <dt>{copy.device}</dt><dd>{vehicle.deviceId ?? "—"}</dd>
          <dt>{copy.sourceRegistration}</dt><dd>{vehicle.sourceRegistration ?? "—"}</dd>
          <dt>{copy.vehicleTypeRaw}</dt><dd>{vehicle.eesIdentity.vehicleType ?? "—"}</dd>
          <dt>{copy.vehicleCategoryRaw}</dt><dd>{vehicle.eesIdentity.vehicleCategory ?? "—"}</dd>
          <dt>{copy.identityReason}</dt><dd>{vehicle.eesIdentity.reason}</dd>
          <dt>{copy.forthReportedDriver}</dt><dd>{vehicle.reportedDriver ?? copy.noDriver}</dd>
        </dl>
      </details>
    </aside>
  );
}

export function FleetTrackingV2LiveWorkspace({ showFixtureLink }: { showFixtureLink: boolean }) {
  const { language, setLanguage } = useLanguage();
  const copy = LIVE_COPY[language];
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [clusterIds, setClusterIds] = useState<string[] | null>(null);
  const [clusterQuery, setClusterQuery] = useState("");
  const [command, setCommand] = useState<Command>({ type: "fit", sequence: 0 });
  const [showUnverifiedPositions, setShowUnverifiedPositions] = useState(false);
  const [dataState, setDataState] = useState<LoadState>({ status: "loading" });
  const startedRef = useRef(false);
  const activeRef = useRef(true);

  const loadLiveData = useCallback(async () => {
    setDataState({ status: "loading" });
    try {
      const sessionResult = await supabase.auth.getSession();
      if (sessionResult.error) throw new Error(copy.requestFailed);
      const token = sessionResult.data.session?.access_token;
      if (!token) throw new Error(copy.signIn);

      const [response, vehicleResult, driverResult] = await Promise.all([
        fetch("/api/admin/forth-tracking/vehicles", {
          method: "GET", cache: "no-store", headers: { Authorization: "Bearer " + token }
        }),
        Promise.resolve(supabase.from("vehicles").select("id,vehicle_reg,vehicle_name,vehicle_type,vehicle_category").order("vehicle_reg", { ascending: true })).catch(() => null),
        Promise.resolve(supabase.from("drivers").select("id,name,active,assigned_vehicle_id").order("name", { ascending: true })).catch(() => null)
      ]);
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const envelope = payload !== null && typeof payload === "object" ? payload as { error?: unknown } : {};
        throw new Error(typeof envelope.error === "string" ? envelope.error : copy.requestFailed);
      }

      const vehicleRegistry = !vehicleResult || vehicleResult.error || !Array.isArray(vehicleResult.data)
        ? null
        : vehicleResult.data as unknown as LiveEesVehicleIdentity[];
      const driverRows = !driverResult || driverResult.error || !Array.isArray(driverResult.data)
        ? null
        : driverResult.data as unknown[];
      const registry = attachUniqueActiveDriverAssignments(vehicleRegistry, driverRows);
      const result = adaptForthFleetResponse(payload, registry);
      if (result.status === "unavailable") throw new Error(result.message);
      if (activeRef.current) {
        setDataState({
          status: "ready",
          records: result.records,
          fetchedAt: result.fetchedAt,
          vehicleRegistryAvailable: result.vehicleRegistryAvailable
        });
      }
    } catch (error) {
      if (activeRef.current) {
        setDataState({ status: "error", message: error instanceof Error && error.message ? error.message : copy.requestFailed });
      }
    }
  }, [copy.requestFailed, copy.signIn]);

  useEffect(() => {
    activeRef.current = true;
    if (!startedRef.current) {
      startedRef.current = true;
      void loadLiveData();
    }
    return () => { activeRef.current = false; };
  }, [loadLiveData]);

  const vehicles = useMemo(() => dataState.status === "ready" ? dataState.records : [], [dataState]);
  const visible = useMemo(() => vehicles.filter((vehicle) => {
    if (!matchesLiveVehicleSearch(vehicle, query)) return false;
    return filter === "all" || getMotionState(vehicle) === filter;
  }), [filter, query, vehicles]);
  const selected = vehicles.find((vehicle) => vehicle.id === selectedId) ?? null;
  const clusterVehicles = clusterIds ? vehicles.filter((vehicle) => clusterIds.includes(vehicle.id)) : [];
  const filteredClusterVehicles = clusterVehicles.filter((vehicle) => matchesLiveVehicleSearch(vehicle, clusterQuery));
  const showDetails = Boolean(selected && detailsOpen && clusterVehicles.length === 0);
  const fleetSummary = useMemo(() => summarizeLiveFleet(vehicles), [vehicles]);
  const reportedPositionCount = vehicles.filter((vehicle) => canShowUnverifiedReportedPosition(vehicle)).length;
  const ready = dataState.status === "ready";

  function selectVehicle(id: string) {
    const vehicle = vehicles.find((entry) => entry.id === id);
    if (!vehicle) return;
    setSelectedId(id);
    setDetailsOpen(true);
    setClusterIds(null);
    if (canFocusVehicle(vehicle)) {
      setCommand((current) => ({ type: "focus", sequence: current.sequence + 1, key: id }));
    }
  }

  function showReportedPositionOnMap() {
    if (!selected || !canShowUnverifiedReportedPosition(selected)) return;
    setShowUnverifiedPositions(true);
    setCommand((current) => ({ type: "focus", sequence: current.sequence + 1, key: selected.id }));
  }

  function fitArea() {
    setClusterIds(null);
    setCommand((current) => ({ type: "fit", sequence: current.sequence + 1 }));
  }

  const filters: Filter[] = ["all", "moving", "stopped", "unknown"];

  return (
    <div className={styles.shell + " " + styles.dashboardShell}>
      <header className={styles.banner}>
        <div className={styles.bannerCopy}>
          <p className={styles.eyebrow}>{copy.eyebrow}</p>
          <h1 className={styles.title}>{copy.title}</h1>
          <p className={styles.notice}>
            <span className={styles.liveDot} aria-hidden="true" />
            {dataState.status === "loading" ? copy.loading : dataState.status === "error" ? copy.errorTitle : copy.sourceNote}
            {dataState.status === "ready" && dataState.fetchedAt ? <span className={styles.fetchedAt}>{copy.fetched} · {formatReportTime(dataState.fetchedAt, language) ?? dataState.fetchedAt}</span> : null}
          </p>
        </div>
        <div className={styles.headerActions}>
          {showFixtureLink ? <Link className={styles.fixtureLink} href="/fleet-tracking-v2/fixture">{copy.fixtureLink}</Link> : null}
          <div className={styles.lang} role="group" aria-label="Language">
            <button type="button" aria-pressed={language === "en"} onClick={() => setLanguage("en")}>{FLEET_TRACKING_V2_COPY.en.languageEn}</button>
            <button type="button" aria-pressed={language === "th"} onClick={() => setLanguage("th")}>{FLEET_TRACKING_V2_COPY.en.languageTh}</button>
          </div>
          <button type="button" className={styles.refreshButton} onClick={() => void loadLiveData()} disabled={dataState.status === "loading"}>
            <RefreshCw size={15} className={dataState.status === "loading" ? styles.spinning : ""} />
            {dataState.status === "error" ? copy.retry : copy.refresh}
          </button>
        </div>
      </header>

      <section className={styles.summaryStrip} aria-label={copy.metricsRecords} aria-live="polite">
        <article className={styles.summaryCard}>
          <span className={styles.summaryIcon}><Truck size={16} /></span>
          <div><span className={styles.summaryLabel}>{copy.metricsRecords}</span><strong>{ready ? vehicles.length : "—"}</strong><small>{ready ? copy.sourceNote : copy.summaryUnavailable}</small></div>
        </article>
        <article className={styles.summaryCard}>
          <span className={styles.summaryIcon}><Activity size={16} /></span>
          <div><span className={styles.summaryLabel}>{copy.metricsActivity}</span><strong>{ready ? `${fleetSummary.activity.driving} ${copy.movingShort} · ${fleetSummary.activity.stopped} ${copy.stoppedShort}` : "—"}</strong><small>{ready ? `${fleetSummary.activity.uncertain} ${copy.uncertainShort} · ${fleetSummary.activity.unavailable} ${copy.unavailableShort}` : copy.summaryUnavailable}</small></div>
        </article>
        <article className={styles.summaryCard}>
          <span className={styles.summaryIcon}><MapPinned size={16} /></span>
          <div><span className={styles.summaryLabel}>{copy.metricsGps}</span><strong>{ready ? `${fleetSummary.gps.verified} / ${vehicles.length}` : "—"}</strong><small>{ready ? `${fleetSummary.gps.unverified} ${copy.unverifiedCount} · ${fleetSummary.gps.unavailable} ${copy.confidenceUnknownShort}` : copy.summaryUnavailable}</small></div>
        </article>
        <article className={styles.summaryCard}>
          <span className={styles.summaryIcon}><Clock3 size={16} /></span>
          <div><span className={styles.summaryLabel}>{copy.metricsReports}</span><strong>{ready ? `${fleetSummary.reports.current} ${copy.reportsCurrent}` : "—"}</strong><small>{ready ? `${fleetSummary.reports.stale} ${copy.reportsStale} · ${fleetSummary.reports.unknown} ${copy.reportsUnknown}` : copy.summaryUnavailable}</small></div>
        </article>
      </section>

      {dataState.status === "error" ? <section className={styles.errorBanner} role="alert"><strong>{copy.errorHelp}</strong><span>{dataState.message}</span></section> : null}
      {dataState.status === "ready" && !dataState.vehicleRegistryAvailable ? <p className={styles.registryNotice} role="status">{copy.identityUnavailable}</p> : null}

      <div className={showDetails ? styles.body + " " + styles.bodyWithInspector : styles.body}>
        <aside className={styles.roster} aria-label={copy.roster}>
          <div className={styles.rosterHead}>
            <div className={styles.rosterHeadRow}><div><h2 className={styles.rosterTitle}>{copy.roster}</h2><p className={styles.rosterHint}>{copy.rosterHint}</p></div><span className={styles.count}>{dataState.status === "ready" ? String(visible.length) : "—"}</span></div>
            <label className={styles.searchBox}>
              <Search size={15} aria-hidden="true" />
              <input type="search" className={styles.search} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.search} aria-label={copy.search} />
              {query ? <button type="button" className={styles.clearSearch} onClick={() => setQuery("")} aria-label={copy.closeDetails}><X size={14} /></button> : null}
            </label>
            <div className={styles.filters}>{filters.map((value) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === "all" ? copy.all : copy[value]}</button>)}</div>
          </div>
          <div className={styles.results} id="fleet-v2-live-vehicle-list">
            {dataState.status === "loading" ? <p className={styles.noResults}>{copy.loading}</p> : null}
            {dataState.status === "error" ? <p className={styles.noResults}>{copy.errorTitle}</p> : null}
            {dataState.status === "ready" && visible.length === 0 ? <p className={styles.noResults}>{vehicles.length ? copy.noResults : copy.noRecords}</p> : null}
            {dataState.status === "ready" ? visible.map((vehicle) => {
              const motion = getMotionState(vehicle);
              const identity = identitySummaryLabel(vehicle, language, copy);
              const shortConfidence = vehicle.gpsConfidence === "verified" ? copy.gpsVerifiedShort : vehicle.gpsConfidence === "unverified" ? copy.gpsUnverifiedShort : copy.gpsUnknownShort;
              const speed = typeof vehicle.speedKph === "number" ? `${vehicle.speedKph} km/h` : "—";
              return (
                <button key={vehicle.id} type="button" className={styles.vehicleRow} aria-pressed={selectedId === vehicle.id} onClick={() => selectVehicle(vehicle.id)}>
                  <span className={styles.vehicleRowHead}>
                    <strong className={styles.reg}>{vehicle.registration || copy.registrationUnavailable}</strong>
                    <span className={styles.activityPill + " " + pillClass(motion)}>{activityLabel(vehicle, copy)}</span>
                  </span>
                  <span className={styles.vehicleIdentity} data-matched={vehicle.eesIdentity.status === "matched"}>
                    {identity}{vehicle.eesIdentity.status === "matched" && vehicle.eesIdentity.assignedDriverName ? ` · ${vehicle.eesIdentity.assignedDriverName}` : ""}
                  </span>
                  <span className={styles.vehicleRowFooter}>
                    <span className={styles.rowSpeed}><Gauge size={13} />{speed}</span>
                    <span className={styles.rowStatus + " " + freshnessTone(vehicle)}><Clock3 size={12} />{rosterFreshnessLabel(vehicle, copy)}</span>
                    <span className={styles.rowStatus + " " + confidenceTone(vehicle)}><MapPin size={12} />{shortConfidence}</span>
                  </span>
                </button>
              );
            }) : null}
          </div>
        </aside>

        <main className={styles.mapPane} aria-label={copy.mapTitle}>
          <div className={styles.mapHeader}>
            <div><h2>{copy.mapTitle}</h2><p>{ready ? `${fleetSummary.gps.verified} ${copy.verifiedShort} · ${vehicles.length} ${copy.metricsRecords.toLocaleLowerCase()}` : copy.summaryUnavailable}</p></div>
            <button type="button" className={styles.fitButton} onClick={fitArea} disabled={!ready}><MapPinned size={15} />{copy.fitArea}</button>
          </div>
          <div className={styles.mapTools}>
            <label className={styles.unverifiedToggle}>
              <input type="checkbox" checked={showUnverifiedPositions} disabled={reportedPositionCount === 0} onChange={(event) => {
                setShowUnverifiedPositions(event.target.checked);
              }} />
              <span>{copy.showUnverified} ({reportedPositionCount})</span>
            </label>
            <div className={styles.mapLegend} role="group" aria-label={copy.mapLegend}>
              <span><i className={styles.verifiedSwatch} aria-hidden="true" />{copy.verifiedMarker}</span>
              <span><i className={styles.reportedSwatch} aria-hidden="true" />{copy.reportedMarker}</span>
            </div>
          </div>
          <div className={styles.mapCanvas}>
            <FleetTrackingV2Map vehicles={vehicles} showUnverifiedPositions={showUnverifiedPositions} selectedId={selectedId} onSelect={selectVehicle} onCluster={(ids) => {
              setClusterIds(ids);
              setClusterQuery("");
              setDetailsOpen(false);
              setSelectedId(null);
            }} command={command} mapUnavailable={copy.unavailableGps} />
            {clusterVehicles.length > 0 ? (
              <section className={styles.clusterPicker} aria-label={copy.clusterTitle}>
                <div className={styles.clusterHeading}>
                  <div><strong>{copy.clusterTitle}</strong><span>{clusterVehicles.length} {copy.chooseVehicle.toLocaleLowerCase()}</span></div>
                  <button type="button" className={styles.iconButton} aria-label={copy.closeDetails} onClick={() => setClusterIds(null)}><X size={15} /></button>
                </div>
                <label className={styles.clusterSearch}>
                  <Search size={14} aria-hidden="true" />
                  <input value={clusterQuery} onChange={(event) => setClusterQuery(event.target.value)} placeholder={copy.searchGroup} aria-label={copy.searchGroup} />
                </label>
                <div className={styles.clusterResults}>
                  {filteredClusterVehicles.length === 0 ? <p className={styles.noResults}>{copy.noGroupMatches}</p> : filteredClusterVehicles.map((vehicle) => (
                    <button key={vehicle.id} type="button" className={styles.clusterRow} aria-pressed={selectedId === vehicle.id} onClick={() => selectVehicle(vehicle.id)}>
                      <span><strong>{vehicle.registration || copy.registrationUnavailable}</strong><small>{activityLabel(vehicle, copy)}</small></span>
                      <span className={styles.clusterSelect}>{copy.chooseVehicle}</span>
                    </button>
                  ))}
                </div>
                <p className={styles.clusterHint}>{copy.clusterHint}</p>
              </section>
            ) : null}
          </div>
        </main>
        {showDetails && selected ? <VehicleDetails vehicle={selected} language={language} copy={copy} onClose={() => setDetailsOpen(false)} onShowReportedPosition={showReportedPositionOnMap} showUnverifiedPositions={showUnverifiedPositions} /> : null}
      </div>
    </div>
  );
}
