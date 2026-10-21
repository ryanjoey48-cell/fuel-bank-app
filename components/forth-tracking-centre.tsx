"use client";

import dynamic from "next/dynamic";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Gauge,
  MapPin,
  MapPinned,
  Navigation,
  RefreshCw,
  Search,
  Signal,
  SignalZero,
  Truck,
  Wifi,
  WifiOff
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { StatCard } from "@/components/stat-card";
import { supabase } from "@/lib/supabase";
import { useLanguage } from "@/lib/language-provider";
import { useAccountAccess } from "@/lib/use-account-access";
import {
  filterForthFleetRecords,
  formatForthTrackingTime,
  getForthMotionReason,
  getForthFleetRecordKey,
  getForthFleetStatus,
  summarizeForthFleet,
  type ForthFleetFilter,
  type ForthFleetStatus
} from "@/lib/forth-tracking-view";
import type { ForthFleetTrackingData, ForthFleetTrackingRecord } from "@/lib/forth-tracking-server";

const ForthTrackingMap = dynamic(
  () => import("@/components/forth-tracking-map").then((module) => module.ForthTrackingMap),
  { ssr: false, loading: () => <div className="h-[min(58vh,620px)] min-h-[360px] animate-pulse rounded-[1.25rem] bg-slate-100" /> }
);

const POLL_INTERVAL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 15_000;
const STATUS_DIAGNOSTIC_SESSION_KEY = "ees-forth-status-diagnostic-used";

type StatusDiagnosticResult = {
  connectionStatus: "connected" | "failed" | "not_configured";
  recordCount: number;
  communications: Record<"online" | "offline" | "unknown", number>;
  positionFreshness: Record<"current" | "stale" | "unknown", number>;
  gpsSignal: Record<"available" | "unavailable" | "unknown", number>;
  positionQuality: Record<"gps" | "wifi" | "lbs" | "other" | "unknown", number>;
  speedAvailability: Record<"available" | "unavailable", number>;
  engineState: Record<"on" | "off" | "unknown", number>;
  classificationReason: Record<string, number>;
  error: string | null;
};

const COPY = {
  en: {
    eyebrow: "Fleet operations",
    title: "Fleet Tracking Centre",
    description: "Live GPS visibility from Forth, separate from vehicle records and mileage workflows.",
    connected: "Connected",
    disconnected: "Awaiting configuration",
    unavailable: "Connection unavailable",
    refresh: "Refresh tracking",
    refreshing: "Updating…",
    lastSync: "Last successful API refresh",
    total: "Tracked vehicles",
    totalHelper: "Records returned by Forth",
    moving: "Moving",
    movingHelper: "Current GPS and positive reported speed",
    parked: "Stationary",
    parkedHelper: "Stationary: fresh GPS position and zero reported speed",
    offline: "GPRS online",
    offlineHelper: "GPRS communication state reported by Forth",
    latestGps: "Latest verified GPS position",
    latestGpsHelper: "Forth position time, separate from API refresh time",
    unknownSummary: "Motion stays unknown when the position, time, GPS signal or speed cannot support a reliable activity reading.",
    freshnessNote: "Current means the reported position is no more than 15 minutes old.",
    stationary: "Stationary",
    activityUnknown: "Motion unknown",
    communications: "Tracker communications",
    positionFreshness: "Position age",
    positionQuality: "Position quality",
    gpsSignal: "GPS signal",
    speedAvailability: "Speed report",
    available: "Available",
    unavailableStatus: "Unavailable",
    gpsQuality: "GPS",
    wifiQuality: "Wi-Fi (approximate)",
    lbsQuality: "LBS (approximate)",
    otherQuality: "Other non-GPS source",
    unknownQuality: "Unknown source",
    motionReasonMoving: "Fresh GPS position with positive reported speed",
    motionReasonStationary: "Fresh GPS position with zero reported speed",
    motionReasonStale: "Position is older than the 15-minute freshness window",
    motionReasonTime: "Position time is missing or could not be interpreted",
    motionReasonCoordinates: "Coordinates are missing",
    motionReasonInvalidCoordinates: "Coordinates are invalid",
    motionReasonGpsUnavailable: "GPS signal unavailable; GPRS may still be online",
    motionReasonGpsUnknown: "GPS signal state was not reported",
    motionReasonSourceUnknown: "Position source was not reported or is unrecognized",
    motionReasonNonGps: "Position is not confirmed as GPS; motion is not inferred",
    motionReasonSpeed: "Speed was not reported",
    motionReasonInvalidSpeed: "Speed value is invalid",
    diagnosticTitle: "One-time status breakdown",
    diagnosticButton: "Run one-time status diagnostic",
    diagnosticConfirm: "Run one read-only Forth request and return aggregate counts only? No vehicle identifiers, coordinates, timestamps, driver details, or raw values will be returned.",
    diagnosticDone: "This diagnostic can run once per browser tab session.",
    diagnosticFailure: "The status diagnostic could not be completed.",
    diagnosticConnection: "Forth request status",
    diagnosticRecords: "Records analyzed",
    diagnosticClassification: "Motion classification reasons",
    configurationTitle: "Forth Tracking is awaiting configuration",
    configurationBody: "This environment is not returning tracking data yet. Fleet counts and map positions will appear after the server is configured.",
    failureTitle: "Forth tracking is temporarily unavailable",
    failureBody: "The latest request did not return usable tracking data. Try again shortly.",
    requestFailure: "The protected tracking request could not be completed. Check your EES session and try again.",
    mapTitle: "Live vehicle map",
    mapDescription: "Select a marker or vehicle to inspect its latest reported position.",
    noPositions: "No vehicles currently have valid coordinates to plot.",
    mapRegionLabel: "Fleet tracking map",
    mapLoading: "Loading map…",
    mapUnavailable: "The map could not be loaded. The vehicle list is still available.",
    listTitle: "Tracked vehicles",
    listDescription: "Search by registration, reported driver or device ID.",
    search: "Search vehicles",
    filter: "Filter by status",
    all: "All statuses",
    unknown: "Motion unknown",
    noVehicles: "Forth returned no tracking records.",
    noMatches: "No vehicles match this search and filter.",
    detailsTitle: "Vehicle details",
    chooseVehicle: "Choose a vehicle from the list or map to see its details.",
    registration: "Registration",
    driver: "Reported driver",
    noDriver: "Not reported",
    device: "GPS device ID",
    speed: "Speed",
    engine: "Engine",
    engineOn: "On",
    engineOff: "Off",
    unknownValue: "Unknown",
    gps: "GPS signal",
    gprs: "Tracker communications (GPRS)",
    online: "Online",
    offlineStatus: "Offline",
    gpsNoFix: "No GPS fix",
    position: "Last known position",
    coordinates: "Coordinates",
    noPosition: "Coordinates unavailable",
    locationStatus: "Location availability",
    validLocation: "Coordinates available",
    missingLocation: "Coordinates not reported",
    invalidLocation: "Coordinates invalid",
    timestamp: "Reported location time",
    sourceTimestamp: "Original Forth timestamp",
    current: "Current",
    stale: "Stale",
    noTimestamp: "Time unavailable",
    timezoneUnconfigured: "Source timezone not configured",
    timezoneInvalid: "Source timezone is invalid",
    ambiguousTime: "Local time is ambiguous",
    invalidTime: "Invalid time",
    positionSource: "Position source",
    gpsSource: "GPS",
    nonGpsSource: "Non-GPS",
    heading: "Heading",
    degrees: "degrees",
    lastUpdated: "Data refreshed",
    mapMoving: "Moving",
    mapParked: "Stationary",
    mapOffline: "Offline",
    mapUnknown: "Motion unknown"
  },
  th: {
    eyebrow: "การปฏิบัติงานยานพาหนะ",
    title: "ศูนย์ติดตามยานพาหนะ",
    description: "ตำแหน่ง GPS จาก Forth แยกจากข้อมูลรถและงานบันทึกเลขไมล์",
    connected: "เชื่อมต่อแล้ว",
    disconnected: "รอการตั้งค่า",
    unavailable: "ไม่สามารถเชื่อมต่อได้",
    refresh: "รีเฟรชข้อมูลติดตาม",
    refreshing: "กำลังอัปเดต…",
    lastSync: "เวลารีเฟรช API สำเร็จล่าสุด",
    total: "รถที่ติดตาม",
    totalHelper: "รายการที่ Forth ส่งกลับมา",
    moving: "กำลังเคลื่อนที่",
    movingHelper: "GPS ปัจจุบันและมีความเร็วมากกว่าศูนย์",
    parked: "หยุดนิ่ง",
    parkedHelper: "ตำแหน่ง GPS ใหม่และความเร็วที่รายงานเป็นศูนย์",
    offline: "GPRS ออนไลน์",
    offlineHelper: "สถานะการสื่อสาร GPRS ที่ Forth รายงาน",
    latestGps: "ตำแหน่ง GPS ที่ยืนยันล่าสุด",
    latestGpsHelper: "เวลาตำแหน่งจาก Forth แยกจากเวลารีเฟรช API",
    unknownSummary: "จะไม่สรุปการเคลื่อนที่เมื่อข้อมูลตำแหน่ง เวลา สัญญาณ GPS หรือความเร็วไม่เพียงพอ",
    freshnessNote: "ข้อมูลปัจจุบันหมายถึงตำแหน่งที่รายงานภายใน 15 นาที",
    stationary: "หยุดนิ่ง",
    activityUnknown: "ไม่ทราบการเคลื่อนที่",
    communications: "การสื่อสารตัวติดตาม",
    positionFreshness: "อายุข้อมูลตำแหน่ง",
    positionQuality: "คุณภาพตำแหน่ง",
    gpsSignal: "สัญญาณ GPS",
    speedAvailability: "ข้อมูลความเร็ว",
    available: "มีข้อมูล",
    unavailableStatus: "ไม่มีข้อมูล",
    gpsQuality: "GPS",
    wifiQuality: "Wi-Fi (โดยประมาณ)",
    lbsQuality: "LBS (โดยประมาณ)",
    otherQuality: "แหล่งอื่นที่ไม่ใช่ GPS",
    unknownQuality: "ไม่ทราบแหล่งที่มา",
    motionReasonMoving: "ตำแหน่ง GPS ใหม่และรายงานความเร็วมากกว่าศูนย์",
    motionReasonStationary: "ตำแหน่ง GPS ใหม่และรายงานความเร็วเป็นศูนย์",
    motionReasonStale: "ตำแหน่งเก่ากว่าช่วงความสดใหม่ 15 นาที",
    motionReasonTime: "ไม่มีเวลาตำแหน่งหรือแปลผลไม่ได้",
    motionReasonCoordinates: "ไม่มีพิกัด",
    motionReasonInvalidCoordinates: "พิกัดไม่ถูกต้อง",
    motionReasonGpsUnavailable: "ไม่มีสัญญาณ GPS แต่อาจยังเชื่อมต่อ GPRS",
    motionReasonGpsUnknown: "ไม่มีรายงานสถานะสัญญาณ GPS",
    motionReasonSourceUnknown: "ไม่มีรายงานแหล่งที่มาหรือไม่รู้จัก",
    motionReasonNonGps: "ยังยืนยันว่าเป็นตำแหน่ง GPS ไม่ได้ จึงไม่สรุปการเคลื่อนที่",
    motionReasonSpeed: "ไม่มีรายงานความเร็ว",
    motionReasonInvalidSpeed: "ค่าความเร็วไม่ถูกต้อง",
    diagnosticTitle: "สรุปสถานะแบบครั้งเดียว",
    diagnosticButton: "เรียกใช้การวินิจฉัยครั้งเดียว",
    diagnosticConfirm: "เรียก Forth แบบอ่านอย่างเดียวหนึ่งครั้งและแสดงเฉพาะจำนวนรวมใช่หรือไม่ จะไม่ส่งกลับทะเบียน พิกัด เวลา รายละเอียดผู้ขับ หรือค่าดิบ",
    diagnosticDone: "การวินิจฉัยนี้เรียกใช้ได้หนึ่งครั้งต่อเซสชันแท็บเบราว์เซอร์",
    diagnosticFailure: "ไม่สามารถวินิจฉัยสถานะได้",
    diagnosticConnection: "สถานะคำขอ Forth",
    diagnosticRecords: "จำนวนรายการที่วิเคราะห์",
    diagnosticClassification: "เหตุผลการจัดประเภทการเคลื่อนที่",
    configurationTitle: "รอการตั้งค่า Forth Tracking",
    configurationBody: "สภาพแวดล้อมนี้ยังไม่ได้ส่งข้อมูลติดตาม จำนวนรถและตำแหน่งบนแผนที่จะปรากฏเมื่อตั้งค่าเซิร์ฟเวอร์แล้ว",
    failureTitle: "Forth Tracking ไม่พร้อมใช้งานชั่วคราว",
    failureBody: "คำขอล่าสุดไม่ได้รับข้อมูลติดตามที่ใช้งานได้ โปรดลองอีกครั้งในภายหลัง",
    requestFailure: "ไม่สามารถดำเนินการคำขอติดตามที่ได้รับการป้องกันได้ โปรดตรวจสอบการเข้าสู่ระบบ EES แล้วลองอีกครั้ง",
    mapTitle: "แผนที่รถแบบเรียลไทม์",
    mapDescription: "เลือกหมุดหรือรถเพื่อดูตำแหน่งล่าสุดที่รายงาน",
    noPositions: "ขณะนี้ไม่มีรถที่มีพิกัดถูกต้องบนแผนที่",
    mapRegionLabel: "แผนที่ติดตามยานพาหนะ",
    mapLoading: "กำลังโหลดแผนที่…",
    mapUnavailable: "โหลดแผนที่ไม่ได้ แต่ยังดูรายการรถได้",
    listTitle: "รถที่ติดตาม",
    listDescription: "ค้นหาด้วยทะเบียน ชื่อผู้ขับที่รายงาน หรือรหัสอุปกรณ์",
    search: "ค้นหารถ",
    filter: "กรองตามสถานะ",
    all: "ทุกสถานะ",
    unknown: "ไม่ทราบการเคลื่อนที่",
    noVehicles: "Forth ไม่ได้ส่งรายการติดตามกลับมา",
    noMatches: "ไม่พบรถที่ตรงกับการค้นหาและตัวกรองนี้",
    detailsTitle: "รายละเอียดรถ",
    chooseVehicle: "เลือกรถจากรายการหรือแผนที่เพื่อดูรายละเอียด",
    registration: "ทะเบียนรถ",
    driver: "ผู้ขับที่รายงาน",
    noDriver: "ไม่มีข้อมูล",
    device: "รหัสอุปกรณ์ GPS",
    speed: "ความเร็ว",
    engine: "เครื่องยนต์",
    engineOn: "เปิด",
    engineOff: "ปิด",
    unknownValue: "ไม่ทราบ",
    gps: "สัญญาณ GPS",
    gprs: "การสื่อสารตัวติดตาม (GPRS)",
    online: "ออนไลน์",
    offlineStatus: "ออฟไลน์",
    gpsNoFix: "ไม่มีสัญญาณ GPS",
    position: "ตำแหน่งล่าสุด",
    coordinates: "พิกัด",
    noPosition: "ไม่มีพิกัด",
    locationStatus: "สถานะตำแหน่ง",
    validLocation: "มีพิกัด",
    missingLocation: "ไม่มีรายงานพิกัด",
    invalidLocation: "พิกัดไม่ถูกต้อง",
    timestamp: "เวลาที่รายงานตำแหน่ง",
    sourceTimestamp: "เวลาต้นฉบับจาก Forth",
    current: "ปัจจุบัน",
    stale: "เก่า",
    noTimestamp: "ไม่มีเวลา",
    timezoneUnconfigured: "ยังไม่ได้ตั้งค่าเขตเวลาต้นทาง",
    timezoneInvalid: "เขตเวลาต้นทางไม่ถูกต้อง",
    ambiguousTime: "เวลาท้องถิ่นกำกวม",
    invalidTime: "เวลาไม่ถูกต้อง",
    positionSource: "แหล่งที่มาของตำแหน่ง",
    gpsSource: "GPS",
    nonGpsSource: "ไม่ใช่ GPS",
    heading: "ทิศทาง",
    degrees: "องศา",
    lastUpdated: "อัปเดตข้อมูล",
    mapMoving: "กำลังเคลื่อนที่",
    mapParked: "หยุดนิ่ง",
    mapOffline: "ออฟไลน์",
    mapUnknown: "ไม่ทราบการเคลื่อนที่"
  }
} as const;

type Copy = { [Key in keyof typeof COPY.en]: string };

function isFleetTrackingData(value: unknown): value is ForthFleetTrackingData {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  return ["not_configured", "connected", "failed"].includes(String(data.connectionStatus)) &&
    Array.isArray(data.records) &&
    (data.fetchedAt === null || typeof data.fetchedAt === "string");
}

function isCountObject(value: unknown): value is Record<string, number> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    Object.values(value as Record<string, unknown>).every((count) => Number.isInteger(count) && Number(count) >= 0);
}

function isStatusDiagnosticResult(value: unknown): value is StatusDiagnosticResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  return ["connected", "failed", "not_configured"].includes(String(result.connectionStatus)) &&
    Number.isInteger(result.recordCount) && Number(result.recordCount) >= 0 &&
    isCountObject(result.communications) &&
    isCountObject(result.positionFreshness) &&
    isCountObject(result.gpsSignal) &&
    isCountObject(result.positionQuality) &&
    isCountObject(result.speedAvailability) &&
    isCountObject(result.engineState) &&
    isCountObject(result.classificationReason) &&
    (result.error === null || typeof result.error === "string");
}

function statusText(status: ForthFleetStatus, copy: Copy) {
  if (status === "moving") return copy.moving;
  if (status === "stationary") return copy.stationary;
  return copy.activityUnknown;
}

function statusStyle(status: ForthFleetStatus) {
  if (status === "moving") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "stationary") return "border-indigo-200 bg-indigo-50 text-indigo-800";
  return "border-slate-200 bg-slate-100 text-slate-700";
}

function StatusPill({ status, copy }: { status: ForthFleetStatus; copy: Copy }) {
  return (
    <span className={`inline-flex min-h-6 items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold leading-none ${statusStyle(status)}`}>
      {statusText(status, copy)}
    </span>
  );
}

function DetailValue({ label, value, icon }: { label: string; value: ReactNode; icon?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-3">
      <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {icon}{label}
      </dt>
      <dd className="mt-1.5 break-words text-sm font-semibold text-slate-800">{value}</dd>
    </div>
  );
}

function recordLocationLabel(record: ForthFleetTrackingRecord, copy: Copy) {
  if (record.coordinateStatus === "missing") return copy.missingLocation;
  if (record.coordinateStatus === "invalid") return copy.invalidLocation;
  if (record.positionQuality === "gps") return `${copy.gpsQuality} · ${record.timestampStatus === "stale" ? copy.stale : record.timestampStatus === "current" ? copy.current : copy.unknownValue}`;
  if (record.positionQuality === "wifi") return copy.wifiQuality;
  if (record.positionQuality === "lbs") return copy.lbsQuality;
  if (record.positionQuality === "other") return copy.otherQuality;
  return copy.unknownQuality;
}

function motionReasonLabel(record: ForthFleetTrackingRecord, copy: Copy) {
  const labels: Record<string, string> = {
    moving: copy.motionReasonMoving,
    stationary: copy.motionReasonStationary,
    stale_position: copy.motionReasonStale,
    position_time_unknown: copy.motionReasonTime,
    coordinates_missing: copy.motionReasonCoordinates,
    coordinates_invalid: copy.motionReasonInvalidCoordinates,
    coordinates_unknown: copy.motionReasonCoordinates,
    gps_signal_unavailable: copy.motionReasonGpsUnavailable,
    gps_signal_unknown: copy.motionReasonGpsUnknown,
    position_source_unknown: copy.motionReasonSourceUnknown,
    non_gps_position: copy.motionReasonNonGps,
    speed_unavailable: copy.motionReasonSpeed,
    speed_invalid: copy.motionReasonInvalidSpeed
  };
  return labels[getForthMotionReason(record)] ?? copy.activityUnknown;
}

function timestampStatusLabel(record: ForthFleetTrackingRecord, copy: Copy) {
  if (record.timestampStatus === "current") return copy.current;
  if (record.timestampStatus === "stale") return copy.stale;
  if (record.timestampStatus === "timezone_unconfigured") return copy.timezoneUnconfigured;
  if (record.timestampStatus === "timezone_invalid") return copy.timezoneInvalid;
  if (record.timestampStatus === "timezone_ambiguous") return copy.ambiguousTime;
  if (record.timestampStatus === "invalid") return copy.invalidTime;
  return copy.noTimestamp;
}

function ConnectivityValue({ connected, copy, connectedLabel, disconnectedLabel }: {
  connected: "connected" | "disconnected" | "unknown";
  copy: Copy;
  connectedLabel?: string;
  disconnectedLabel?: string;
}) {
  if (connected === "connected") return <span className="inline-flex items-center gap-1.5 text-emerald-700"><Wifi className="h-4 w-4" />{connectedLabel ?? copy.online}</span>;
  if (connected === "disconnected") return <span className="inline-flex items-center gap-1.5 text-rose-700"><WifiOff className="h-4 w-4" />{disconnectedLabel ?? copy.offlineStatus}</span>;
  return <span className="inline-flex items-center gap-1.5 text-slate-500"><SignalZero className="h-4 w-4" />{copy.unknownValue}</span>;
}

export function ForthTrackingCentre() {
  const { language } = useLanguage();
  const { can } = useAccountAccess();
  const copy = COPY[language];
  const [data, setData] = useState<ForthFleetTrackingData | null>(null);
  const [lastSuccessfulRefreshAt, setLastSuccessfulRefreshAt] = useState<string | null>(null);
  const [requestError, setRequestError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ForthFleetFilter>("all");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [statusDiagnostic, setStatusDiagnostic] = useState<StatusDiagnosticResult | null>(null);
  const [statusDiagnosticBusy, setStatusDiagnosticBusy] = useState(false);
  const [statusDiagnosticAttempted, setStatusDiagnosticAttempted] = useState(false);
  const [statusDiagnosticError, setStatusDiagnosticError] = useState(false);
  const refreshRef = useRef<() => Promise<void>>(async () => undefined);
  const statusDiagnosticStartedRef = useRef(false);

  useEffect(() => {
    try {
      if (window.sessionStorage.getItem(STATUS_DIAGNOSTIC_SESSION_KEY) === "1") {
        setStatusDiagnosticAttempted(true);
      }
    } catch {
      // The in-memory guard still prevents duplicate activation if storage is unavailable.
    }
  }, []);

  const runStatusDiagnostic = async () => {
    if (statusDiagnosticStartedRef.current) return;
    try {
      if (window.sessionStorage.getItem(STATUS_DIAGNOSTIC_SESSION_KEY) === "1") {
        setStatusDiagnosticAttempted(true);
        return;
      }
    } catch {
      // Fall through to the in-memory single-use guard.
    }
    if (!window.confirm(copy.diagnosticConfirm)) return;
    statusDiagnosticStartedRef.current = true;
    setStatusDiagnosticAttempted(true);
    setStatusDiagnosticBusy(true);
    setStatusDiagnosticError(false);
    try {
      window.sessionStorage.setItem(STATUS_DIAGNOSTIC_SESSION_KEY, "1");
    } catch {
      // The in-memory guard still applies for this page when storage is unavailable.
    }
    try {
      const { data: authData, error: authError } = await supabase.auth.getSession();
      if (authError || !authData.session?.access_token) throw new Error("session_unavailable");
      const response = await fetch("/api/admin/forth-tracking/status-diagnostic?confirm=aggregate-only", {
        method: "GET",
        cache: "no-store",
        headers: { Authorization: `Bearer ${authData.session.access_token}` }
      });
      if (!response.ok) throw new Error("diagnostic_unavailable");
      const payload: unknown = await response.json();
      if (!isStatusDiagnosticResult(payload)) throw new Error("invalid_diagnostic");
      setStatusDiagnostic(payload);
    } catch {
      setStatusDiagnosticError(true);
    } finally {
      setStatusDiagnosticBusy(false);
    }
  };

  useEffect(() => {
    let active = true;
    let inFlight = false;
    let requestController: AbortController | null = null;

    const load = async () => {
      if (!active || inFlight) return;
      inFlight = true;
      requestController = new AbortController();
      const timeout = window.setTimeout(() => requestController?.abort(), REQUEST_TIMEOUT_MS);
      setRefreshing(true);

      try {
        const { data: authData, error: authError } = await supabase.auth.getSession();
        if (authError || !authData.session?.access_token) throw new Error("session_unavailable");

        const response = await fetch("/api/admin/forth-tracking/vehicles", {
          method: "GET",
          cache: "no-store",
          signal: requestController.signal,
          headers: { Authorization: `Bearer ${authData.session.access_token}` }
        });
        if (!response.ok) throw new Error("request_unavailable");
        const payload: unknown = await response.json();
        if (!isFleetTrackingData(payload)) throw new Error("invalid_response");
        if (active) {
          if (payload.connectionStatus === "connected" && payload.fetchedAt) {
            setLastSuccessfulRefreshAt(payload.fetchedAt);
          }
          setData(payload);
          setRequestError(false);
          setSelectedKey((current) => current && payload.records.some((record, index) => getForthFleetRecordKey(record, index) === current) ? current : null);
        }
      } catch {
        if (active && !requestController.signal.aborted) {
          setData(null);
          setRequestError(true);
          setSelectedKey(null);
        } else if (active) {
          setData(null);
          setRequestError(true);
          setSelectedKey(null);
        }
      } finally {
        window.clearTimeout(timeout);
        inFlight = false;
        if (active) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    };

    refreshRef.current = load;
    void load();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_INTERVAL_MS);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
      requestController?.abort();
    };
  }, []);

  const connected = data?.connectionStatus === "connected";
  const summary = useMemo(() => summarizeForthFleet(data?.records ?? []), [data?.records]);
  const visibleRecords = useMemo(
    () => filterForthFleetRecords(data?.records ?? [], search, filter),
    [data?.records, filter, search]
  );
  const selectedRecord = useMemo(() => {
    if (!data || !selectedKey) return null;
    return data.records.find((record, index) => getForthFleetRecordKey(record, index) === selectedKey) ?? null;
  }, [data, selectedKey]);
  const lastGpsUpdate = formatForthTrackingTime(summary.lastVerifiedGpsPosition, language);
  const lastChecked = formatForthTrackingTime(
    lastSuccessfulRefreshAt ?? (data?.connectionStatus === "connected" ? data.fetchedAt : null),
    language
  );
  const mapCopy = useMemo(() => ({
    moving: copy.mapMoving,
    parked: copy.mapParked,
    unknown: copy.mapUnknown,
    gpsQuality: copy.gpsQuality,
    wifiQuality: copy.wifiQuality,
    lbsQuality: copy.lbsQuality,
    otherQuality: copy.otherQuality,
    unknownQuality: copy.unknownQuality,
    current: copy.current,
    stale: copy.stale,
    noPositions: copy.noPositions,
    loading: copy.mapLoading,
    mapUnavailable: copy.mapUnavailable,
    mapRegionLabel: copy.mapRegionLabel
  }), [copy]);

  const trackingMessage = requestError
    ? copy.requestFailure
    : data?.error?.message ?? copy.failureBody;

  return (
    <main className="mx-auto w-full max-w-[1720px] space-y-6 px-3 pb-10 pt-4 sm:px-5 lg:px-7 lg:pt-6">
      <header className="flex flex-col gap-4 rounded-[1.6rem] border border-violet-100 bg-[linear-gradient(130deg,rgba(255,255,255,0.98),rgba(248,246,252,0.95))] p-5 shadow-[0_14px_38px_rgba(41,24,72,0.06)] sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.19em] text-violet-700">{copy.eyebrow}</p>
          <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">{copy.title}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{copy.description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <span className={`inline-flex min-h-9 items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold ${connected ? "border-emerald-200 bg-emerald-50 text-emerald-800" : data?.connectionStatus === "not_configured" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-slate-200 bg-white text-slate-600"}`}>
            {connected ? <CheckCircle2 className="h-4 w-4" /> : data?.connectionStatus === "not_configured" ? <AlertTriangle className="h-4 w-4" /> : <Signal className="h-4 w-4" />}
            {connected ? copy.connected : data?.connectionStatus === "not_configured" ? copy.disconnected : data?.connectionStatus === "failed" || requestError ? copy.unavailable : copy.mapLoading}
          </span>
          <button
            type="button"
            className="btn-secondary justify-center gap-2"
            onClick={() => void refreshRef.current()}
            disabled={refreshing || loading}
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? copy.refreshing : copy.refresh}
          </button>
        </div>
      </header>

      {data?.connectionStatus === "not_configured" || data?.connectionStatus === "failed" || requestError ? (
        <section className={`flex items-start gap-3 rounded-2xl border p-4 sm:p-5 ${data?.connectionStatus === "not_configured" ? "border-amber-200 bg-amber-50/80" : "border-rose-200 bg-rose-50/80"}`} role="status">
          <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${data?.connectionStatus === "not_configured" ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700"}`}>
            {data?.connectionStatus === "not_configured" ? <SignalZero className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
          </span>
          <div>
            <h2 className="font-semibold text-slate-900">{data?.connectionStatus === "not_configured" ? copy.configurationTitle : copy.failureTitle}</h2>
            <p className="mt-1 text-sm leading-6 text-slate-700">{data?.connectionStatus === "not_configured" ? copy.configurationBody : trackingMessage}</p>
          </div>
        </section>
      ) : null}

      <section aria-label={language === "th" ? "สรุปสถานะกองรถ" : "Fleet overview"} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <StatCard label={copy.total} value={connected ? String(summary.total) : "—"} helper={copy.totalHelper} icon={<Truck className="h-5 w-5" />} />
        <StatCard label={copy.moving} value={connected ? String(summary.motion.moving) : "—"} helper={copy.movingHelper} icon={<Activity className="h-5 w-5" />} />
        <StatCard label={copy.parked} value={connected ? String(summary.motion.stationary) : "—"} helper={copy.parkedHelper} icon={<Gauge className="h-5 w-5" />} />
        <StatCard label={copy.offline} value={connected ? String(summary.communications.online) : "—"} helper={copy.offlineHelper} icon={<Wifi className="h-5 w-5" />} />
        <StatCard label={copy.positionFreshness} value={connected ? String(summary.positionFreshness.current) : "—"} helper={copy.freshnessNote} icon={<Clock3 className="h-5 w-5" />} />
        <StatCard label={copy.latestGps} value={connected ? lastGpsUpdate ?? "—" : "—"} helper={copy.latestGpsHelper} icon={<Clock3 className="h-5 w-5" />} valueVariant="date" />
      </section>

      {connected ? (
        <section className="-mt-3 grid gap-2 rounded-2xl border border-slate-100 bg-white/80 p-3 text-xs leading-5 text-slate-600 sm:grid-cols-2 xl:grid-cols-4" aria-label={language === "th" ? "สรุปคุณภาพข้อมูล" : "Tracking data dimensions"}>
          <p><strong className="text-slate-800">{copy.communications}:</strong> {copy.online} {summary.communications.online} · {copy.offlineStatus} {summary.communications.offline} · {copy.unknownValue} {summary.communications.unknown}</p>
          <p><strong className="text-slate-800">{copy.positionFreshness}:</strong> {copy.current} {summary.positionFreshness.current} · {copy.stale} {summary.positionFreshness.stale} · {copy.unknownValue} {summary.positionFreshness.unknown} <span className="block text-[11px] text-slate-500">{copy.freshnessNote}</span></p>
          <p><strong className="text-slate-800">{copy.positionQuality}:</strong> GPS {summary.positionQuality.gps} · Wi-Fi {summary.positionQuality.wifi} · LBS {summary.positionQuality.lbs} · {copy.otherQuality} {summary.positionQuality.other} · {copy.unknownValue} {summary.positionQuality.unknown}</p>
          <p><strong className="text-slate-800">{copy.gpsSignal}:</strong> {copy.available} {summary.gpsSignal.available} · {copy.unavailableStatus} {summary.gpsSignal.unavailable} · {copy.unknownValue} {summary.gpsSignal.unknown}<span className="block">{copy.activityUnknown}: {summary.motion.unknown}</span></p>
        </section>
      ) : null}

      {connected && can("business:read") ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5" aria-label={copy.diagnosticTitle}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-bold text-slate-900">{copy.diagnosticTitle}</h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">{copy.diagnosticConfirm}</p>
            </div>
            <button type="button" className="btn-secondary shrink-0 justify-center gap-2" onClick={() => void runStatusDiagnostic()} disabled={statusDiagnosticBusy || statusDiagnosticAttempted}>
              <Activity className={`h-4 w-4 ${statusDiagnosticBusy ? "animate-pulse" : ""}`} />
              {statusDiagnosticBusy ? copy.refreshing : copy.diagnosticButton}
            </button>
          </div>
          {statusDiagnostic ? (
            <div className="mt-4 grid gap-2 border-t border-slate-100 pt-3 text-xs leading-5 text-slate-600 sm:grid-cols-2 lg:grid-cols-3" aria-live="polite">
              <p><strong>{copy.diagnosticConnection}:</strong> {statusDiagnostic.connectionStatus}</p>
              <p><strong>{copy.diagnosticRecords}:</strong> {statusDiagnostic.recordCount}</p>
              <p><strong>{copy.communications}:</strong> {Object.entries(statusDiagnostic.communications).map(([key, count]) => `${key} ${count}`).join(" · ")}</p>
              <p><strong>{copy.positionFreshness}:</strong> {Object.entries(statusDiagnostic.positionFreshness).map(([key, count]) => `${key} ${count}`).join(" · ")}</p>
              <p><strong>{copy.gpsSignal}:</strong> {Object.entries(statusDiagnostic.gpsSignal).map(([key, count]) => `${key} ${count}`).join(" · ")}</p>
              <p><strong>{copy.positionQuality}:</strong> {Object.entries(statusDiagnostic.positionQuality).map(([key, count]) => `${key} ${count}`).join(" · ")}</p>
              <p><strong>{copy.speedAvailability}:</strong> {Object.entries(statusDiagnostic.speedAvailability).map(([key, count]) => `${key} ${count}`).join(" · ")}</p>
              <p><strong>{copy.engine}:</strong> {Object.entries(statusDiagnostic.engineState).map(([key, count]) => `${key} ${count}`).join(" · ")}</p>
              <p className="sm:col-span-2 lg:col-span-3"><strong>{copy.diagnosticClassification}:</strong> {Object.entries(statusDiagnostic.classificationReason).filter(([, count]) => count > 0).map(([key, count]) => `${key.replaceAll("_", " ")} ${count}`).join(" · ") || "—"}</p>
            </div>
          ) : statusDiagnosticError ? <p className="mt-3 text-xs text-rose-700" role="status">{copy.diagnosticFailure}</p> : statusDiagnosticAttempted ? <p className="mt-3 text-xs text-slate-600" role="status">{copy.diagnosticDone}</p> : null}
        </section>
      ) : null}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(340px,0.9fr)]">
        <section className="surface-card min-w-0 overflow-hidden p-3 sm:p-4">
          <div className="mb-3 flex items-start justify-between gap-3 px-1 pt-1">
            <div>
              <h2 className="flex items-center gap-2 text-base font-bold text-slate-950"><MapPinned className="h-5 w-5 text-violet-700" />{copy.mapTitle}</h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">{copy.mapDescription}</p>
            </div>
            {connected ? <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">{summary.total}</span> : null}
          </div>
          {connected ? (
            <ForthTrackingMap records={data.records} selectedKey={selectedKey} onSelect={setSelectedKey} language={language} copy={mapCopy} />
          ) : (
            <div className="flex min-h-[360px] flex-col items-center justify-center rounded-[1.25rem] border border-dashed border-slate-200 bg-slate-50 px-5 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-violet-700 shadow-sm"><MapPin className="h-7 w-7" /></span>
              <p className="mt-4 max-w-sm text-sm font-medium leading-6 text-slate-600">{data?.connectionStatus === "not_configured" ? copy.configurationBody : copy.noPositions}</p>
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" />{copy.lastSync}: {lastChecked ?? "—"}</span>
            <span>{language === "th" ? "อัปเดตอัตโนมัติทุก 60 วินาที" : "Auto-refreshes every 60 seconds"}</span>
          </div>
          {connected ? (
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 border-t border-slate-100 px-1 pt-3 text-[11px] text-slate-600" aria-label={language === "th" ? "คำอธิบายสถานะหมุด" : "Map marker status legend"}>
              <span className="inline-flex items-center gap-1.5"><i aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-emerald-600" />{copy.mapMoving}</span>
              <span className="inline-flex items-center gap-1.5"><i aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-indigo-600" />{copy.mapParked}</span>
              <span className="inline-flex items-center gap-1.5"><i aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-slate-500" />{copy.mapUnknown}</span>
              <span className="inline-flex items-center gap-1.5"><i aria-hidden="true" className="h-2.5 w-2.5 rounded-full border-2 border-dashed border-amber-700" />{copy.wifiQuality} / {copy.lbsQuality} / {copy.unknownQuality}</span>
            </div>
          ) : null}
        </section>

        <section className="surface-card min-w-0 p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-950">{copy.listTitle}</h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">{copy.listDescription}</p>
            </div>
            {connected ? <span className="rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-bold text-violet-800">{visibleRecords.length}</span> : null}
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] xl:grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_auto]">
            <label className="relative block">
              <span className="sr-only">{copy.search}</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={copy.search}
                type="search"
                className="min-h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
              />
            </label>
            <label className="sr-only" htmlFor="forth-fleet-filter">{copy.filter}</label>
            <select
              id="forth-fleet-filter"
              aria-label={copy.filter}
              value={filter}
              onChange={(event) => setFilter(event.target.value as ForthFleetFilter)}
              className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            >
              <option value="all">{copy.all}</option>
              <option value="moving">{copy.moving}</option>
              <option value="stationary">{copy.stationary}</option>
              <option value="unknown">{copy.unknown}</option>
            </select>
          </div>

          <div className="mt-3 max-h-[450px] space-y-2 overflow-y-auto pr-1">
            {connected && data.records.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">{copy.noVehicles}</div>
            ) : null}
            {connected && data.records.length > 0 && visibleRecords.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">{copy.noMatches}</div>
            ) : null}
            {connected ? visibleRecords.map((record) => {
              const index = data.records.indexOf(record);
              const key = getForthFleetRecordKey(record, index);
              const status = getForthFleetStatus(record);
              const updateTime = formatForthTrackingTime(record.lastGpsTimestamp, language);
              const active = key === selectedKey;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSelectedKey(key)}
                  className={`block w-full rounded-xl border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 ${active ? "border-violet-300 bg-violet-50/70 shadow-sm" : "border-slate-100 bg-white hover:border-violet-200 hover:bg-slate-50/70"}`}
                >
                  <span className="flex min-w-0 items-start justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-bold text-slate-900">{record.vehicleRegistration || copy.unknownValue}</span>
                      <span className="mt-0.5 block truncate text-xs text-slate-500">{record.reportedDriver || copy.noDriver}</span>
                    </span>
                    <StatusPill status={status} copy={copy} />
                  </span>
                  <span className="mt-1 block text-left text-[11px] leading-4 text-slate-500">{motionReasonLabel(record, copy)}</span>
                  <span className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs text-slate-600">
                    <span className="inline-flex min-w-0 items-center gap-1.5"><Gauge className="h-3.5 w-3.5 shrink-0 text-slate-400" />{record.speed === null ? copy.unknownValue : `${record.speed} km/h`}</span>
                    <span className="inline-flex min-w-0 items-center gap-1.5"><Activity className="h-3.5 w-3.5 shrink-0 text-slate-400" />{copy.engine}: {record.engineOn === null ? copy.unknownValue : record.engineOn ? copy.engineOn : copy.engineOff}</span>
                    <span className="inline-flex min-w-0 items-center gap-1.5">{record.gpsConnectivity === "connected" ? <Wifi className="h-3.5 w-3.5 shrink-0 text-emerald-600" /> : <SignalZero className="h-3.5 w-3.5 shrink-0 text-slate-400" />}{record.gpsConnectivity === "connected" ? copy.available : record.gpsConnectivity === "disconnected" ? copy.gpsNoFix : copy.unknownValue}</span>
                    <span className="inline-flex min-w-0 items-center gap-1.5">{record.gprsConnectivity === "connected" ? <Wifi className="h-3.5 w-3.5 shrink-0 text-emerald-600" /> : <WifiOff className="h-3.5 w-3.5 shrink-0 text-slate-400" />}{copy.gprs}: {record.gprsConnectivity === "connected" ? copy.online : record.gprsConnectivity === "disconnected" ? copy.offlineStatus : copy.unknownValue}</span>
                    <span className="inline-flex min-w-0 items-center gap-1.5"><Clock3 className="h-3.5 w-3.5 shrink-0 text-slate-400" />{updateTime ?? timestampStatusLabel(record, copy)}</span>
                    <span className="inline-flex min-w-0 items-center gap-1.5"><MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" />{recordLocationLabel(record, copy)}</span>
                  </span>
                </button>
              );
            }) : null}
            {!connected && !loading && !requestError && data?.connectionStatus !== "not_configured" ? (
              <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">{copy.failureBody}</div>
            ) : null}
            {loading && !data ? <div className="rounded-xl border border-slate-100 px-4 py-8 text-center text-sm text-slate-500">{copy.mapLoading}</div> : null}
          </div>
        </section>
      </div>

      {selectedRecord ? (
        <section className="surface-card p-4 sm:p-5" aria-labelledby="forth-vehicle-details-title">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-violet-700">{copy.detailsTitle}</p>
              <h2 id="forth-vehicle-details-title" className="mt-1 text-xl font-bold text-slate-950">{selectedRecord.vehicleRegistration || copy.unknownValue}</h2>
              {selectedRecord.reportedDriver ? <p className="mt-1 text-sm text-slate-500">{copy.driver}: {selectedRecord.reportedDriver}</p> : null}
            </div>
            <StatusPill status={getForthFleetStatus(selectedRecord)} copy={copy} />
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-500">{motionReasonLabel(selectedRecord, copy)}</p>

          <dl className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            <DetailValue label={copy.device} icon={<Signal className="h-3.5 w-3.5" />} value={selectedRecord.gpsDeviceId || copy.unknownValue} />
            <DetailValue label={copy.speed} icon={<Gauge className="h-3.5 w-3.5" />} value={selectedRecord.speed === null ? copy.unknownValue : `${selectedRecord.speed} km/h`} />
            <DetailValue label={copy.engine} icon={<Activity className="h-3.5 w-3.5" />} value={selectedRecord.engineOn === null ? copy.unknownValue : selectedRecord.engineOn ? copy.engineOn : copy.engineOff} />
            <DetailValue label={copy.gps} icon={<Signal className="h-3.5 w-3.5" />} value={<ConnectivityValue connected={selectedRecord.gpsConnectivity} copy={copy} connectedLabel={copy.available} disconnectedLabel={copy.gpsNoFix} />} />
            <DetailValue label={copy.gprs} icon={<Wifi className="h-3.5 w-3.5" />} value={<ConnectivityValue connected={selectedRecord.gprsConnectivity} copy={copy} />} />
            <DetailValue label={copy.locationStatus} icon={<MapPin className="h-3.5 w-3.5" />} value={recordLocationLabel(selectedRecord, copy)} />
            <DetailValue
              label={copy.position}
              icon={<Navigation className="h-3.5 w-3.5" />}
              value={selectedRecord.coordinateStatus === "valid" && selectedRecord.latitude !== null && selectedRecord.longitude !== null ? (
                <a
                  className="text-violet-700 underline decoration-violet-300 underline-offset-2 hover:text-violet-900"
                  href={`https://www.google.com/maps/search/?api=1&query=${selectedRecord.latitude},${selectedRecord.longitude}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {selectedRecord.latitude.toFixed(5)}, {selectedRecord.longitude.toFixed(5)}
                </a>
              ) : copy.noPosition}
            />
            <DetailValue label={copy.timestamp} icon={<Clock3 className="h-3.5 w-3.5" />} value={<span>{formatForthTrackingTime(selectedRecord.lastGpsTimestamp, language) ?? copy.unknownValue}<span className="mt-1 block text-xs font-medium text-slate-500">{timestampStatusLabel(selectedRecord, copy)}</span></span>} />
            <DetailValue label={copy.sourceTimestamp} icon={<Clock3 className="h-3.5 w-3.5" />} value={selectedRecord.sourceTimestampRaw || copy.unknownValue} />
            <DetailValue label={copy.positionQuality} icon={<MapPinned className="h-3.5 w-3.5" />} value={<span>{selectedRecord.positionSource || recordLocationLabel(selectedRecord, copy)}</span>} />
            <DetailValue label={copy.heading} icon={<Navigation className="h-3.5 w-3.5" />} value={selectedRecord.heading === null ? copy.unknownValue : `${selectedRecord.heading} ${copy.degrees}`} />
          </dl>
        </section>
      ) : (
        <section className="surface-card flex items-center gap-3 p-4 sm:p-5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-700"><Truck className="h-5 w-5" /></span>
          <p className="text-sm text-slate-600">{copy.chooseVehicle}</p>
        </section>
      )}
    </main>
  );
}
