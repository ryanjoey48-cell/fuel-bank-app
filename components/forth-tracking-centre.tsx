"use client";

import dynamic from "next/dynamic";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Gauge,
  List,
  MapPin,
  MapPinned,
  Navigation,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  Search,
  Signal,
  SignalZero,
  Truck,
  Wifi,
  WifiOff,
  X
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { useLanguage } from "@/lib/language-provider";
import { useAccountAccess } from "@/lib/use-account-access";
import {
  createForthStatusDiagnosticRunner,
  FORTH_STATUS_DIAGNOSTIC_SESSION_KEY,
  type ForthStatusDiagnosticFailure,
  type ForthStatusDiagnosticOutcome
} from "@/lib/forth-status-diagnostic-client";
import {
  filterForthFleetRecords,
  formatForthRelativeAge,
  formatForthTrackingTime,
  getForthFleetMapInitialFrame,
  getForthAccuracyComparisons,
  getForthFleetRecordKey,
  findForthFleetRecord,
  getForthFleetMapRecords,
  getForthNormalizationWarnings,
  getForthReportedActivity,
  isForthGpsPositionVerified,
  summarizeForthFleet,
  sortForthFleetRecords,
  type ForthFleetFilter,
  type ForthAccuracyField,
  type ForthNormalizationWarning,
  type ForthFleetSort,
  type ForthReportedActivity
} from "@/lib/forth-tracking-view";
import type { ForthFleetTrackingData, ForthFleetTrackingRecord } from "@/lib/forth-tracking-server";
import type { ForthSourceFieldSnapshot } from "@/lib/forth-tracking";

const ForthTrackingMap = dynamic(
  () => import("@/components/forth-tracking-map").then((module) => module.ForthTrackingMap),
  { ssr: false, loading: () => <div className="min-h-0 flex-1 animate-pulse rounded-2xl bg-slate-100" /> }
);

const POLL_INTERVAL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 15_000;
type PositionSourceShapeCounts = Record<
  "missing" | "null" | "empty" | "number" | "boolean" | "recognized_string" | "unrecognized_string" | "other",
  number
>;

type StatusDiagnosticResult = {
  connectionStatus: "connected" | "failed" | "not_configured";
  recordCount: number;
  communications: Record<"online" | "offline" | "unknown", number>;
  positionFreshness: Record<"current" | "stale" | "unknown", number>;
  gpsSignal: Record<"available" | "unavailable" | "unknown", number>;
  positionQuality: Record<"gps" | "no_gps" | "wifi" | "lbs" | "other" | "unknown", number>;
  speedAvailability: Record<"available" | "unavailable", number>;
  engineState: Record<"on" | "off" | "unknown", number>;
  classificationReason: Record<string, number>;
  positionSourceShape: {
    canonicalField: PositionSourceShapeCounts;
    alternateCandidateRecords: number;
    alternateCandidateValues: PositionSourceShapeCounts;
  };
  unknownPositionSourceStrings: {
    unknownStringCount: number;
    returnedUniqueCount: number;
    notListedOccurrences: number;
    rejectedOccurrences: number;
    labels: Array<{ label: string; occurrences: number }>;
  };
  error: string | null;
};

type StatusDiagnosticUiState =
  | "checking"
  | "ready"
  | "awaiting_confirmation"
  | "running"
  | "completed"
  | "failed"
  | "previously_attempted";

type StatusDiagnosticRunner = {
  run(): Promise<ForthStatusDiagnosticOutcome<StatusDiagnosticResult>>;
  isAttemptUsed(): boolean;
};
type TrackingRequestFailure = "session" | "authorization" | "timeout" | "upstream" | "invalid_response" | "network";

type MapViewCommand = { type: "fit" | "focus"; sequence: number; key?: string | null };

const COPY = {
  en: {
    eyebrow: "Fleet operations",
    title: "Fleet Tracking Centre",
    description: "Live fleet activity from Forth, with GPS confidence shown separately.",
    connected: "Connected",
    disconnected: "Awaiting configuration",
    unavailable: "Connection unavailable",
    refresh: "Refresh tracking",
    refreshing: "Updating…",
    lastSync: "Last EES refresh",
    total: "Fleet vehicles",
    totalHelper: "of tracked vehicles",
    moving: "Driving now",
    movingHelper: "Fresh reported speed above zero",
    parked: "Stopped now",
    parkedHelper: "Fresh reported speed is zero",
    engineOnStops: "Stopped · engine on",
    engineOnStopsHelper: "Latest report only; duration is not available",
    offline: "Tracker offline",
    offlineHelper: "Forth reports GPRS disconnected",
    locationNotGpsVerified: "Position unverified",
    locationNotGpsVerifiedHelper: "Position does not meet GPS confidence checks",
    latestGps: "Latest current GPS position",
    latestGpsHelper: "Fresh position confirmed by GPS",
    needsAttention: "Needs attention",
    needsAttentionHelper: "Offline or position report older than 15 minutes",
    countOf: "of",
    tracked: "tracked",
    unknownSummary: "Reported activity uses fresh speed and engine data. GPS confidence is assessed separately.",
    provisionalMovement: "GPS-verified driving",
    provisionalMovementNote: "Requires a fresh position explicitly identified as GPS, GPS signal and valid coordinates.",
    provisionalBadge: "Reported driving · position not GPS-verified",
    freshnessNote: "Current means the reported position is no more than 15 minutes old.",
    stationary: "Reported stopped",
    activityUnknown: "Activity unavailable",
    activityUnavailable: "Activity unavailable",
    activityUnavailableHelper: "Speed is missing, invalid or older than 15 minutes",
    activityDriving: "Driving now",
    activityStoppedEngineOn: "Stopped now · Engine on",
    activityStoppedEngineOff: "Stopped now · Engine off",
    activityStoppedEngineUnknown: "Stopped now · Engine unknown",
    communications: "Tracker communications",
    positionFreshness: "Position age",
    positionQuality: "Position quality",
    gpsSignal: "GPS signal",
    gpsSourceSignalNote: "Forth reports GPS signal and position source separately. “No GPS” remains unverified even when the GPS signal field reports available.",
    speedAvailability: "Speed report",
    available: "Available",
    unavailableStatus: "Unavailable",
    gpsQuality: "GPS",
    noGpsQuality: "No GPS · GPS position unverified",
    wifiQuality: "Wi-Fi (approximate)",
    lbsQuality: "LBS (approximate)",
    otherQuality: "Other non-GPS source",
    unknownQuality: "Unknown source",
    motionReasonMoving: "Fresh reported speed is above zero",
    motionReasonStationary: "Fresh reported speed is zero",
    motionReasonStale: "Position is older than the 15-minute freshness window",
    motionReasonTime: "Position time is missing or could not be interpreted",
    motionReasonCoordinates: "Coordinates are missing",
    motionReasonInvalidCoordinates: "Coordinates are invalid",
    motionReasonGpsUnavailable: "GPS signal unavailable; GPRS may still be online",
    motionReasonGpsUnknown: "GPS signal state was not reported",
    motionReasonSourceUnknown: "Position source was not reported or is unrecognized",
    motionReasonNoGps: "Forth reports “No GPS” for this position source; motion is not GPS-verified",
    motionReasonNonGps: "Position is not confirmed as GPS; motion is not inferred",
    motionReasonSpeed: "Speed was not reported",
    motionReasonInvalidSpeed: "Speed value is invalid",
    diagnosticTitle: "One-time status breakdown",
    diagnosticAdvancedTitle: "Advanced one-time diagnostic",
    diagnosticButton: "Run one-time status diagnostic",
    diagnosticRetryButton: "Try again after sign-in",
    diagnosticIntro: "One protected, read-only request. You will confirm before it starts; results are not saved.",
    diagnosticStateChecking: "Checking this tab",
    diagnosticStateReady: "Ready",
    diagnosticStateAwaiting: "Awaiting confirmation",
    diagnosticStateRunning: "Running",
    diagnosticStateCompleted: "Completed",
    diagnosticStateFailed: "Failed",
    diagnosticStatePreviouslyAttempted: "Attempt already used",
    diagnosticReadyBody: "Ready. No diagnostic request is sent until you confirm. It can run once in this browser tab session.",
    diagnosticAwaitingBody: "Review the details and choose Confirm to run. Cancel leaves the one-time attempt available.",
    diagnosticRunningBody: "One protected, read-only request is in progress. This attempt will not be retried automatically.",
    diagnosticCompletedBody: "The diagnostic completed. Its sanitized results are shown below and are not saved across a page refresh.",
    diagnosticPreviouslyAttemptedBody: "A one-time marker already exists for this tab. An earlier page version could set it before checking your EES session, so we cannot verify whether its protected request started. This tab stays locked for safety; results are not saved across refreshes.",
    diagnosticSessionError: "Could not verify your EES sign-in. No diagnostic request was sent and the one-time attempt remains available. Sign in again, then start and confirm a new attempt.",
    diagnosticUnauthorizedError: "The protected endpoint rejected your EES session. This request attempt is used; check your sign-in before another authorized attempt.",
    diagnosticForbiddenError: "This EES account lacks the required office business:read permission. The request attempt is used; ask an EES administrator to review access.",
    diagnosticHttpError: "The protected diagnostic endpoint returned an error. This request attempt is used; no automatic retry was made.",
    diagnosticNetworkError: "The protected diagnostic request could not be completed. This request attempt is used; no automatic retry was made.",
    diagnosticInvalidResponseError: "The endpoint response did not match the sanitized diagnostic format. This request attempt is used; no automatic retry was made.",
    diagnosticDuplicateError: "A diagnostic request is already in progress.",
    diagnosticDialogTitle: "Confirm one-time Forth diagnostic",
    diagnosticDialogBody: "This sends one protected, read-only request. It returns aggregate counts and bounded unknown positionSource labels only. No coordinates, vehicle or driver details, credentials, or tokens are displayed or saved.",
    diagnosticDialogCancel: "Cancel",
    diagnosticDialogRun: "Confirm and run diagnostic",
    diagnosticEndpointError: "The diagnostic endpoint ran but could not retrieve a complete Forth result:",
    diagnosticConnection: "Forth request status",
    diagnosticRecords: "Records analyzed",
    diagnosticSourceShape: "Position-source field shape",
    diagnosticAlternateSources: "Records with alternate source-like fields",
    diagnosticUnknownSourceLabels: "Unrecognized positionSource labels",
    diagnosticUnknownSourceNote: "These are untrusted source labels; no positioning meaning is inferred.",
    diagnosticClassification: "Motion classification reasons",
    accuracyTitle: "Tracking accuracy review",
    accuracyIntro: "Compare the allowlisted Forth API fields with EES-normalized values from the current tracking refresh. This view is read-only, is not saved, and does not make another Forth request.",
    accuracySearch: "Find a vehicle in the accuracy review",
    accuracySearchPlaceholder: "Registration, device ID or reported driver",
    accuracySourceColumn: "Forth API value",
    accuracyNormalizedColumn: "EES value",
    accuracyNotApplicable: "Not an upstream field",
    accuracyNoMatches: "No vehicles match this review search.",
    accuracyMissing: "Missing",
    accuracyNull: "Null",
    accuracyEmpty: "Empty",
    accuracyUnsupported: "Unsupported value type; value omitted",
    accuracyTruncated: "Value shortened for safe display",
    accuracyNoWarnings: "No normalization warnings for these fields.",
    accuracyWarnings: "Normalization warnings",
    accuracyActivityStatus: "Forth activity/status",
    accuracyLatitude: "Latitude",
    accuracyLongitude: "Longitude",
    accuracyActivityNotMapped: "EES does not currently map an explicit Forth activity field; its presence in this API response has not been verified.",
    accuracyActivityDerived: "EES shows reported activity derived from fresh Speed and Engine fields; this is not a Forth Working/Parking status.",
    accuracySignalExplanation: "GPS signal and position source are separate Forth fields. A reported GPS signal does not turn a No GPS source into GPS-verified positioning.",
    accuracySpeedUnitNote: "EES currently displays Speed as km/h without conversion. This matched one reviewed Forth screen (66 km/h); the public API schema does not specify the unit.",
    warningRegistrationMissing: "Registration missing or empty",
    warningDeviceMissing: "GPS device ID missing or empty",
    warningDriverFiltered: "Driver value was omitted by the safe display filter",
    warningSpeedMissing: "Speed missing or empty",
    warningSpeedInvalid: "Speed could not be normalized as a valid non-negative number",
    warningEngineUnknown: "Engine state missing or unrecognized",
    warningCoordinatesMissing: "Coordinates missing",
    warningCoordinatesInvalid: "Coordinates invalid or out of range",
    warningHeadingInvalid: "Heading could not be normalized to 0–360 degrees",
    warningGpsUnknown: "GPS signal is missing or unrecognized",
    warningGprsUnknown: "GPRS communication state is missing or unrecognized",
    warningTimestampStale: "Position report is older than the 15-minute freshness window",
    warningTimestampUnknown: "Position timestamp is missing or could not be parsed",
    warningSourceUnknown: "Position source is missing or not in the recognized list",
    warningTruncated: "One or more source text values were shortened to a safe display length",
    configurationTitle: "Forth Tracking is awaiting configuration",
    configurationBody: "This environment is not returning tracking data yet. Fleet counts and map positions will appear after the server is configured.",
    failureTitle: "Forth tracking is temporarily unavailable",
    failureBody: "The latest request did not return usable tracking data. Try again shortly.",
    requestFailure: "The protected tracking request could not be completed. Check your EES session and try again.",
    requestSessionFailure: "Your EES session is unavailable. Sign in again to refresh live tracking.",
    requestAuthorizationFailure: "Your EES account could not access live tracking. Sign in again or ask an EES administrator to review office access.",
    requestTimeoutFailure: "The live tracking request timed out. Current vehicle data is hidden until a refresh succeeds.",
    requestUpstreamFailure: "Forth tracking could not be reached. Current vehicle data is hidden until a refresh succeeds.",
    requestInvalidResponseFailure: "The tracking service returned an unreadable response. Current vehicle data is hidden until a refresh succeeds.",
    staleSnapshotHidden: "Live telemetry is hidden until a refresh succeeds. Last successful refresh:",
    mapTitle: "Live vehicle map",
    mapDescription: "Select a marker or vehicle to inspect its latest reported position.",
    noPositions: "No vehicles currently have valid coordinates to plot.",
    mapRegionLabel: "Fleet tracking map",
    mapLoading: "Loading map…",
    mapUnavailable: "The map could not be loaded. The vehicle list is still available.",
    listTitle: "Tracked vehicles",
    listDescription: "Search by registration, reported driver or device ID.",
    search: "Search vehicles",
    filter: "Filter by reported activity",
    all: "All activity",
    drivingFilter: "Reported driving",
    stoppedFilter: "Reported stopped",
    unknown: "Activity unavailable",
    sort: "Sort vehicles",
    sortRegistration: "Registration",
    sortSpeed: "Speed: highest first",
    sortUpdated: "Position time: newest first",
    showingVehicles: "Showing",
    ofVehicles: "of",
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
    gpsPositionVerified: "GPS position verified",
    gpsPositionUnverified: "Position not GPS-verified",
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
    mapMoving: "Driving now",
    mapParked: "Stopped now",
    mapOffline: "Activity unavailable",
    mapUnknown: "Activity unavailable",
    mapConfidence: "Dashed amber ring = position not GPS-verified; a cluster shows it if any member is unverified",
    mapClusterUnverified: "At least one position in this group is not GPS-verified",
    mapClusterVerified: "All positions in this group are GPS-verified",
    mapClusterDriving: "Driving",
    mapClusterStopped: "Stopped",
    mapClusterUnavailable: "Activity unavailable",
    mapOfflineLegend: "Red corner dot means GPRS is reported offline",
    mapSelectedLegend: "Purple ring marks the selected vehicle",
    mapEngineOnStop: "Amber = stopped, engine on",
    mapEngineOffStop: "Indigo = stopped, engine off",
    mapEngineUnknownStop: "Grey = engine state unknown",
    mapLabelHint: "Vehicle labels declutter as markers overlap; select a vehicle to prioritize its label",
    freshnessShort: "Freshness window: 15 min",
    lastVehicleUpdate: "Last vehicle update",
    exactPositionTime: "Exact Bangkok time",
    openDetails: "Open details",
    mapFitFleet: "Fit fleet",
    mapHideInspector: "Hide details",
    mapShowInspector: "Show details",
    mapBrowseVehicles: "Browse vehicles",
    mapCloseInspector: "Close details",
    attention: "Fleet attention",
    activeFilter: "Showing",
    resetFilter: "Reset filter",
    noGpsSourceNote: "“No GPS” is Forth's position-source label; its full meaning is not confirmed.",
    attentionNote: "Offline and stale reports need action. Unverified positions and engine-on stops are context.",
    attentionOffline: "Tracker offline",
    attentionStale: "Position older than 15 min",
    attentionUnverified: "Position unverified",
    attentionEngineStopped: "Stopped · engine on",
    attentionOperations: "Operational",
    attentionDataQuality: "Data quality",
    attentionNormal: "Normal stop",
    attentionEngineNote: "Snapshot only · no duration reported",
    attentionNone: "No offline or stale reports",
    filterAttention: "Needs attention",
    filterOnline: "Tracker online",
    filterOffline: "Tracker offline",
    filterStale: "Stale position",
    filterUnverified: "Position unverified",
    filterEngineOnStopped: "Stopped · engine on",
    activityGroup: "Activity",
    attentionGroup: "Fleet signals",
    listCount: "vehicles",
    driverUnavailable: "Driver unavailable",
    onlineLabel: "Online",
    engineOnLabel: "Engine on",
    engineOffLabel: "Engine off",
    currentGpsCount: "Current GPS positions",
    locationSection: "Location and confidence",
    connectionTimingSection: "Tracker and timing",
    sourceSection: "Position source",
    reportedCoordinates: "Reported coordinates",
    approximateCoordinatesNote: "Position source is not GPS-verified; coordinates may be approximate.",
    focusOnMap: "Focus on map",
    activityBasis: "Based on a fresh reported speed"
  },
  th: {
    eyebrow: "การปฏิบัติงานยานพาหนะ",
    title: "ศูนย์ติดตามยานพาหนะ",
    description: "กิจกรรมรถจาก Forth พร้อมแสดงความมั่นใจ GPS แยกต่างหาก",
    connected: "เชื่อมต่อแล้ว",
    disconnected: "รอการตั้งค่า",
    unavailable: "ไม่สามารถเชื่อมต่อได้",
    refresh: "รีเฟรชข้อมูลติดตาม",
    refreshing: "กำลังอัปเดต…",
    lastSync: "รีเฟรช EES ล่าสุด",
    total: "รถทั้งหมด",
    totalHelper: "จากรถที่ติดตาม",
    moving: "กำลังขับ",
    movingHelper: "ความเร็วรายงานใหม่มากกว่าศูนย์",
    parked: "หยุดอยู่",
    parkedHelper: "ความเร็วรายงานใหม่เป็นศูนย์",
    engineOnStops: "หยุด · เครื่องยนต์เปิด",
    engineOnStopsHelper: "เฉพาะข้อมูลรายงานล่าสุด ไม่มีระยะเวลา",
    offline: "ตัวติดตามออฟไลน์",
    offlineHelper: "Forth รายงานว่า GPRS ขาดการเชื่อมต่อ",
    locationNotGpsVerified: "ตำแหน่งยังไม่ยืนยัน",
    locationNotGpsVerifiedHelper: "ตำแหน่งไม่ผ่านเงื่อนไขความมั่นใจ GPS",
    latestGps: "ตำแหน่ง GPS ปัจจุบันล่าสุด",
    latestGpsHelper: "ตำแหน่งใหม่ที่ยืนยันด้วย GPS",
    needsAttention: "ควรตรวจสอบ",
    needsAttentionHelper: "ออฟไลน์หรือรายงานตำแหน่งเกิน 15 นาที",
    countOf: "จาก",
    tracked: "คันที่ติดตาม",
    unknownSummary: "กิจกรรมจากความเร็วและสถานะเครื่องยนต์ที่ยังใหม่ ส่วนความมั่นใจ GPS แสดงแยกต่างหาก",
    provisionalMovement: "รายงานว่าขับโดยยืนยันด้วย GPS",
    provisionalMovementNote: "ต้องเป็นตำแหน่งใหม่ที่ระบุแหล่ง GPS สัญญาณ GPS พร้อมพิกัดถูกต้อง",
    provisionalBadge: "รายงานว่าขับ · ตำแหน่งยังไม่ยืนยันด้วย GPS",
    freshnessNote: "ข้อมูลปัจจุบันหมายถึงตำแหน่งที่รายงานภายใน 15 นาที",
    stationary: "รายงานว่าหยุด",
    activityUnknown: "ไม่มีกิจกรรมที่ยืนยันได้",
    activityUnavailable: "ไม่มีกิจกรรมที่ยืนยันได้",
    activityUnavailableHelper: "ไม่มีความเร็วที่ถูกต้องหรือข้อมูลเก่ากว่า 15 นาที",
    activityDriving: "กำลังขับ",
    activityStoppedEngineOn: "หยุดอยู่ · เครื่องยนต์เปิด",
    activityStoppedEngineOff: "หยุดอยู่ · เครื่องยนต์ปิด",
    activityStoppedEngineUnknown: "หยุดอยู่ · ไม่ทราบสถานะเครื่องยนต์",
    communications: "การสื่อสารตัวติดตาม",
    positionFreshness: "อายุข้อมูลตำแหน่ง",
    positionQuality: "คุณภาพตำแหน่ง",
    gpsSignal: "สัญญาณ GPS",
    gpsSourceSignalNote: "Forth รายงานสัญญาณ GPS และแหล่งตำแหน่งแยกกัน รายการ “No GPS” จะยังไม่ยืนยันด้วย GPS แม้ฟิลด์สัญญาณ GPS จะรายงานว่ามีสัญญาณ",
    speedAvailability: "ข้อมูลความเร็ว",
    available: "มีข้อมูล",
    unavailableStatus: "ไม่มีข้อมูล",
    gpsQuality: "GPS",
    noGpsQuality: "ไม่มี GPS · ยังยืนยันตำแหน่งด้วย GPS ไม่ได้",
    wifiQuality: "Wi-Fi (โดยประมาณ)",
    lbsQuality: "LBS (โดยประมาณ)",
    otherQuality: "แหล่งอื่นที่ไม่ใช่ GPS",
    unknownQuality: "ไม่ทราบแหล่งที่มา",
    motionReasonMoving: "ความเร็วที่รายงานใหม่มากกว่าศูนย์",
    motionReasonStationary: "ความเร็วที่รายงานใหม่เป็นศูนย์",
    motionReasonStale: "ตำแหน่งเก่ากว่าช่วงความสดใหม่ 15 นาที",
    motionReasonTime: "ไม่มีเวลาตำแหน่งหรือแปลผลไม่ได้",
    motionReasonCoordinates: "ไม่มีพิกัด",
    motionReasonInvalidCoordinates: "พิกัดไม่ถูกต้อง",
    motionReasonGpsUnavailable: "ไม่มีสัญญาณ GPS แต่อาจยังเชื่อมต่อ GPRS",
    motionReasonGpsUnknown: "ไม่มีรายงานสถานะสัญญาณ GPS",
    motionReasonSourceUnknown: "ไม่มีรายงานแหล่งที่มาหรือไม่รู้จัก",
    motionReasonNoGps: "Forth รายงานแหล่งตำแหน่งเป็น “No GPS” จึงยังไม่ยืนยันการเคลื่อนที่ด้วย GPS",
    motionReasonNonGps: "ยังยืนยันว่าเป็นตำแหน่ง GPS ไม่ได้ จึงไม่สรุปการเคลื่อนที่",
    motionReasonSpeed: "ไม่มีรายงานความเร็ว",
    motionReasonInvalidSpeed: "ค่าความเร็วไม่ถูกต้อง",
    diagnosticTitle: "สรุปสถานะแบบครั้งเดียว",
    diagnosticAdvancedTitle: "การวินิจฉัยขั้นสูงแบบครั้งเดียว",
    diagnosticButton: "เรียกใช้การวินิจฉัยครั้งเดียว",
    diagnosticRetryButton: "ลองอีกครั้งหลังเข้าสู่ระบบ",
    diagnosticIntro: "คำขอแบบอ่านอย่างเดียวที่ได้รับการป้องกันหนึ่งครั้ง คุณจะยืนยันก่อนเริ่ม และไม่มีการบันทึกผลลัพธ์",
    diagnosticStateChecking: "กำลังตรวจสอบแท็บนี้",
    diagnosticStateReady: "พร้อม",
    diagnosticStateAwaiting: "รอการยืนยัน",
    diagnosticStateRunning: "กำลังทำงาน",
    diagnosticStateCompleted: "เสร็จสิ้น",
    diagnosticStateFailed: "ไม่สำเร็จ",
    diagnosticStatePreviouslyAttempted: "ใช้สิทธิ์ครั้งเดียวแล้ว",
    diagnosticReadyBody: "พร้อม ระบบจะไม่ส่งคำขอวินิจฉัยจนกว่าคุณจะยืนยัน ใช้งานได้หนึ่งครั้งในเซสชันแท็บนี้",
    diagnosticAwaitingBody: "ตรวจสอบรายละเอียดแล้วเลือกยืนยันเพื่อดำเนินการ การยกเลิกจะยังไม่ใช้สิทธิ์ครั้งเดียว",
    diagnosticRunningBody: "กำลังส่งคำขอแบบอ่านอย่างเดียวที่ได้รับการป้องกันหนึ่งครั้ง ระบบจะไม่ลองซ้ำโดยอัตโนมัติ",
    diagnosticCompletedBody: "การวินิจฉัยเสร็จสิ้น ผลลัพธ์ที่ผ่านการจำกัดข้อมูลจะแสดงด้านล่างและไม่บันทึกหลังรีเฟรชหน้า",
    diagnosticPreviouslyAttemptedBody: "พบเครื่องหมายการใช้สิทธิ์ครั้งเดียวในแท็บนี้ หน้าเวอร์ชันก่อนอาจตั้งเครื่องหมายก่อนตรวจสอบเซสชัน EES จึงยืนยันไม่ได้ว่าคำขอเริ่มแล้วหรือไม่ เพื่อความปลอดภัย แท็บนี้จะไม่ส่งซ้ำ และผลลัพธ์จะไม่ถูกบันทึกหลังรีเฟรช",
    diagnosticSessionError: "ตรวจสอบการเข้าสู่ระบบ EES ไม่ได้ จึงยังไม่ได้ส่งคำขอวินิจฉัยและสิทธิ์ครั้งเดียวยังไม่ถูกใช้ โปรดเข้าสู่ระบบใหม่ แล้วเริ่มและยืนยันคำขออีกครั้ง",
    diagnosticUnauthorizedError: "ปลายทางที่ได้รับการป้องกันปฏิเสธเซสชัน EES คำขอครั้งนี้ถูกใช้แล้ว โปรดตรวจสอบการเข้าสู่ระบบก่อนขอให้ผู้มีสิทธิ์ดำเนินการอีกครั้ง",
    diagnosticForbiddenError: "บัญชี EES นี้ไม่มีสิทธิ์สำนักงาน business:read ที่กำหนด คำขอครั้งนี้ถูกใช้แล้ว โปรดให้ผู้ดูแล EES ตรวจสอบสิทธิ์",
    diagnosticHttpError: "ปลายทางวินิจฉัยส่งข้อผิดพลาด คำขอครั้งนี้ถูกใช้แล้วและไม่มีการลองซ้ำโดยอัตโนมัติ",
    diagnosticNetworkError: "ดำเนินการคำขอวินิจฉัยที่ได้รับการป้องกันไม่สำเร็จ คำขอครั้งนี้ถูกใช้แล้วและไม่มีการลองซ้ำโดยอัตโนมัติ",
    diagnosticInvalidResponseError: "รูปแบบคำตอบจากปลายทางไม่ตรงกับข้อมูลวินิจฉัยที่จำกัดไว้ คำขอครั้งนี้ถูกใช้แล้วและไม่มีการลองซ้ำโดยอัตโนมัติ",
    diagnosticDuplicateError: "มีคำขอวินิจฉัยกำลังทำงานอยู่",
    diagnosticDialogTitle: "ยืนยันการวินิจฉัย Forth แบบครั้งเดียว",
    diagnosticDialogBody: "จะส่งคำขอแบบอ่านอย่างเดียวที่ได้รับการป้องกันหนึ่งครั้ง โดยส่งกลับเฉพาะจำนวนรวมและป้าย positionSource ที่ไม่รู้จักตามขีดจำกัด ไม่มีพิกัด ข้อมูลรถหรือผู้ขับ ข้อมูลรับรอง หรือโทเค็นแสดงหรือบันทึก",
    diagnosticDialogCancel: "ยกเลิก",
    diagnosticDialogRun: "ยืนยันและเริ่มวินิจฉัย",
    diagnosticEndpointError: "ปลายทางวินิจฉัยทำงานแล้ว แต่ไม่สามารถรับข้อมูล Forth ได้ครบถ้วน:",
    diagnosticConnection: "สถานะคำขอ Forth",
    diagnosticRecords: "จำนวนรายการที่วิเคราะห์",
    diagnosticSourceShape: "รูปแบบฟิลด์แหล่งตำแหน่ง",
    diagnosticAlternateSources: "รายการที่มีฟิลด์แหล่งตำแหน่งอื่นที่เป็นไปได้",
    diagnosticUnknownSourceLabels: "ป้าย positionSource ที่ไม่รู้จัก",
    diagnosticUnknownSourceNote: "ป้ายเหล่านี้เป็นข้อมูลที่ยังไม่ยืนยัน และจะไม่อนุมานความหมาย",
    diagnosticClassification: "เหตุผลการจัดประเภทการเคลื่อนที่",
    accuracyTitle: "ตรวจสอบความถูกต้องของข้อมูลติดตาม",
    accuracyIntro: "เปรียบเทียบฟิลด์ API ของ Forth ที่อนุญาตให้แสดงกับค่าที่ EES ปรับรูปแบบจากการรีเฟรชปัจจุบัน หน้านี้อ่านอย่างเดียว ไม่บันทึก และไม่ส่งคำขอ Forth เพิ่ม",
    accuracySearch: "ค้นหารถในหน้าตรวจสอบความถูกต้อง",
    accuracySearchPlaceholder: "ทะเบียน รหัสอุปกรณ์ หรือผู้ขับที่รายงาน",
    accuracySourceColumn: "ค่าจาก Forth API",
    accuracyNormalizedColumn: "ค่าใน EES",
    accuracyNotApplicable: "ไม่ใช่ฟิลด์จากระบบต้นทาง",
    accuracyNoMatches: "ไม่พบรถที่ตรงกับการค้นหา",
    accuracyMissing: "ไม่มีฟิลด์",
    accuracyNull: "ค่า Null",
    accuracyEmpty: "ค่าว่าง",
    accuracyUnsupported: "ไม่รองรับชนิดข้อมูล จึงไม่แสดงค่า",
    accuracyTruncated: "ย่อค่าเพื่อแสดงอย่างปลอดภัย",
    accuracyNoWarnings: "ไม่พบคำเตือนการปรับรูปแบบในฟิลด์เหล่านี้",
    accuracyWarnings: "คำเตือนการปรับรูปแบบ",
    accuracyActivityStatus: "สถานะกิจกรรมจาก Forth",
    accuracyLatitude: "ละติจูด",
    accuracyLongitude: "ลองจิจูด",
    accuracyActivityNotMapped: "ขณะนี้ EES ยังไม่ได้แมปฟิลด์กิจกรรมจาก Forth โดยตรง และยังไม่ได้ยืนยันว่าฟิลด์นี้มีอยู่ในการตอบกลับ API",
    accuracyActivityDerived: "EES แสดงกิจกรรมที่คำนวณจาก Speed และ Engine ที่ยังใหม่ ซึ่งไม่ใช่สถานะ Working/Parking ของ Forth",
    accuracySignalExplanation: "สัญญาณ GPS และแหล่งตำแหน่งเป็นคนละฟิลด์จาก Forth สัญญาณ GPS ที่รายงานไม่ได้เปลี่ยนแหล่ง No GPS ให้เป็นตำแหน่งที่ยืนยันด้วย GPS",
    accuracySpeedUnitNote: "ขณะนี้ EES แสดง Speed เป็น กม./ชม. โดยไม่แปลงหน่วย ค่าตรงกับหน้าจอ Forth ที่ตรวจหนึ่งรายการ (66 กม./ชม.) แต่สคีมา API สาธารณะไม่ได้ระบุหน่วย",
    warningRegistrationMissing: "ไม่มีทะเบียนหรือเป็นค่าว่าง",
    warningDeviceMissing: "ไม่มีรหัสอุปกรณ์ GPS หรือเป็นค่าว่าง",
    warningDriverFiltered: "ละค่าผู้ขับเนื่องจากไม่ผ่านตัวกรองการแสดงผลที่ปลอดภัย",
    warningSpeedMissing: "ไม่มีความเร็วหรือเป็นค่าว่าง",
    warningSpeedInvalid: "ไม่สามารถปรับความเร็วเป็นตัวเลขไม่ติดลบที่ถูกต้อง",
    warningEngineUnknown: "ไม่มีสถานะเครื่องยนต์หรือไม่รู้จักค่า",
    warningCoordinatesMissing: "ไม่มีพิกัด",
    warningCoordinatesInvalid: "พิกัดไม่ถูกต้องหรืออยู่นอกช่วง",
    warningHeadingInvalid: "ไม่สามารถปรับทิศทางเป็น 0–360 องศาได้",
    warningGpsUnknown: "ไม่มีสัญญาณ GPS หรือไม่รู้จักค่า",
    warningGprsUnknown: "ไม่มีสถานะการสื่อสาร GPRS หรือไม่รู้จักค่า",
    warningTimestampStale: "เวลารายงานตำแหน่งเก่ากว่าช่วง 15 นาที",
    warningTimestampUnknown: "ไม่มีเวลาตำแหน่งหรือแยกวิเคราะห์ไม่ได้",
    warningSourceUnknown: "ไม่มีแหล่งตำแหน่งหรือไม่อยู่ในรายการที่รู้จัก",
    warningTruncated: "ข้อความต้นทางอย่างน้อยหนึ่งค่าถูกตัดให้สั้นเพื่อแสดงอย่างปลอดภัย",
    configurationTitle: "รอการตั้งค่า Forth Tracking",
    configurationBody: "สภาพแวดล้อมนี้ยังไม่ได้ส่งข้อมูลติดตาม จำนวนรถและตำแหน่งบนแผนที่จะปรากฏเมื่อตั้งค่าเซิร์ฟเวอร์แล้ว",
    failureTitle: "Forth Tracking ไม่พร้อมใช้งานชั่วคราว",
    failureBody: "คำขอล่าสุดไม่ได้รับข้อมูลติดตามที่ใช้งานได้ โปรดลองอีกครั้งในภายหลัง",
    requestFailure: "ไม่สามารถดำเนินการคำขอติดตามที่ได้รับการป้องกันได้ โปรดตรวจสอบการเข้าสู่ระบบ EES แล้วลองอีกครั้ง",
    requestSessionFailure: "ไม่พบเซสชัน EES โปรดเข้าสู่ระบบอีกครั้งเพื่อรีเฟรชข้อมูลติดตามสด",
    requestAuthorizationFailure: "บัญชี EES นี้ไม่สามารถเข้าถึงข้อมูลติดตามสดได้ โปรดเข้าสู่ระบบอีกครั้งหรือติดต่อผู้ดูแลระบบเพื่อตรวจสอบสิทธิ์สำนักงาน",
    requestTimeoutFailure: "คำขอติดตามสดหมดเวลา ซ่อนข้อมูลรถปัจจุบันจนกว่าจะรีเฟรชสำเร็จ",
    requestUpstreamFailure: "ไม่สามารถเชื่อมต่อ Forth Tracking ได้ ซ่อนข้อมูลรถปัจจุบันจนกว่าจะรีเฟรชสำเร็จ",
    requestInvalidResponseFailure: "บริการติดตามส่งข้อมูลที่อ่านไม่ได้ ซ่อนข้อมูลรถปัจจุบันจนกว่าจะรีเฟรชสำเร็จ",
    staleSnapshotHidden: "ซ่อนข้อมูลติดตามสดจนกว่าจะรีเฟรชสำเร็จ รีเฟรชครั้งล่าสุดที่สำเร็จ:",
    mapTitle: "แผนที่รถแบบเรียลไทม์",
    mapDescription: "เลือกหมุดหรือรถเพื่อดูตำแหน่งล่าสุดที่รายงาน",
    noPositions: "ขณะนี้ไม่มีรถที่มีพิกัดถูกต้องบนแผนที่",
    mapRegionLabel: "แผนที่ติดตามยานพาหนะ",
    mapLoading: "กำลังโหลดแผนที่…",
    mapUnavailable: "โหลดแผนที่ไม่ได้ แต่ยังดูรายการรถได้",
    listTitle: "รถที่ติดตาม",
    listDescription: "ค้นหาด้วยทะเบียน ชื่อผู้ขับที่รายงาน หรือรหัสอุปกรณ์",
    search: "ค้นหารถ",
    filter: "กรองตามกิจกรรมที่รายงาน",
    all: "ทุกกิจกรรม",
    drivingFilter: "รายงานว่ากำลังขับ",
    stoppedFilter: "รายงานว่าหยุด",
    unknown: "ไม่มีกิจกรรมที่ยืนยันได้",
    sort: "เรียงรถ",
    sortRegistration: "ทะเบียนรถ",
    sortSpeed: "ความเร็ว: มากไปน้อย",
    sortUpdated: "เวลาตำแหน่ง: ใหม่ไปเก่า",
    showingVehicles: "แสดง",
    ofVehicles: "จาก",
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
    gpsPositionVerified: "ยืนยันตำแหน่ง GPS แล้ว",
    gpsPositionUnverified: "ตำแหน่งยังไม่ยืนยันด้วย GPS",
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
    mapMoving: "กำลังขับ",
    mapParked: "หยุดอยู่",
    mapOffline: "ไม่มีกิจกรรมที่ยืนยันได้",
    mapUnknown: "ไม่มีกิจกรรมที่ยืนยันได้",
    mapConfidence: "วงประสีเหลือง = ตำแหน่งยังไม่ยืนยัน GPS; กลุ่มจะแสดงเมื่อมีสมาชิกที่ยังไม่ยืนยัน",
    mapClusterUnverified: "อย่างน้อยหนึ่งตำแหน่งในกลุ่มนี้ยังไม่ยืนยันด้วย GPS",
    mapClusterVerified: "ทุกตำแหน่งในกลุ่มนี้ยืนยันด้วย GPS แล้ว",
    mapClusterDriving: "กำลังขับ",
    mapClusterStopped: "หยุดอยู่",
    mapClusterUnavailable: "ไม่มีกิจกรรมที่ยืนยันได้",
    mapOfflineLegend: "จุดสีแดงที่มุมหมายถึงรายงานว่า GPRS ออฟไลน์",
    mapSelectedLegend: "วงสีม่วงแสดงรถที่เลือก",
    mapEngineOnStop: "สีเหลืองอำพัน = หยุด เครื่องยนต์เปิด",
    mapEngineOffStop: "สีคราม = หยุด เครื่องยนต์ปิด",
    mapEngineUnknownStop: "สีเทา = ไม่ทราบสถานะเครื่องยนต์",
    mapLabelHint: "ซ่อนป้ายทะเบียนเมื่อหมุดทับกัน; เลือกรถเพื่อจัดลำดับป้ายทะเบียนก่อน",
    freshnessShort: "ช่วงข้อมูลปัจจุบัน: 15 นาที",
    lastVehicleUpdate: "อัปเดตรถล่าสุด",
    exactPositionTime: "เวลาประเทศไทย",
    openDetails: "เปิดรายละเอียด",
    mapFitFleet: "แสดงรถทั้งหมด",
    mapHideInspector: "ซ่อนรายละเอียด",
    mapShowInspector: "แสดงรายละเอียด",
    mapBrowseVehicles: "เลือกรถ",
    mapCloseInspector: "ปิดรายละเอียด",
    attention: "รายการที่ควรตรวจสอบ",
    activeFilter: "กำลังแสดง",
    resetFilter: "ล้างตัวกรอง",
    noGpsSourceNote: "“No GPS” เป็นป้ายแหล่งตำแหน่งจาก Forth แต่ยังไม่ยืนยันความหมายทั้งหมด",
    attentionNote: "รถออฟไลน์และรายงานเก่าควรตรวจสอบ ส่วนตำแหน่งไม่ยืนยันและเครื่องยนต์เปิดเป็นข้อมูลประกอบ",
    attentionOffline: "ตัวติดตามออฟไลน์",
    attentionStale: "ตำแหน่งเกิน 15 นาที",
    attentionUnverified: "ตำแหน่งยังไม่ยืนยัน",
    attentionEngineStopped: "หยุด · เครื่องยนต์เปิด",
    attentionOperations: "การปฏิบัติงาน",
    attentionDataQuality: "คุณภาพข้อมูล",
    attentionNormal: "หยุดตามปกติ",
    attentionEngineNote: "ข้อมูลล่าสุด · ไม่มีระยะเวลา",
    attentionNone: "ไม่มีรายงานออฟไลน์หรือเก่า",
    filterAttention: "ควรตรวจสอบ",
    filterOnline: "ตัวติดตามออนไลน์",
    filterOffline: "ตัวติดตามออฟไลน์",
    filterStale: "ตำแหน่งเก่า",
    filterUnverified: "ตำแหน่งยังไม่ยืนยัน",
    filterEngineOnStopped: "หยุด · เครื่องยนต์เปิด",
    activityGroup: "กิจกรรม",
    attentionGroup: "สัญญาณกองรถ",
    listCount: "คัน",
    driverUnavailable: "ไม่มีข้อมูลผู้ขับ",
    onlineLabel: "ออนไลน์",
    engineOnLabel: "เครื่องยนต์เปิด",
    engineOffLabel: "เครื่องยนต์ปิด",
    currentGpsCount: "ตำแหน่ง GPS ปัจจุบัน",
    locationSection: "ตำแหน่งและความมั่นใจ",
    connectionTimingSection: "ตัวติดตามและเวลา",
    sourceSection: "แหล่งตำแหน่ง",
    reportedCoordinates: "พิกัดที่รายงาน",
    approximateCoordinatesNote: "แหล่งตำแหน่งยังไม่ยืนยันด้วย GPS พิกัดอาจเป็นค่าโดยประมาณ",
    focusOnMap: "โฟกัสบนแผนที่",
    activityBasis: "อ้างอิงจากความเร็วที่รายงานและยังใหม่"
  }
} as const;

type Copy = { [Key in keyof typeof COPY.en]: string };

const SOURCE_AUDIT_FIELDS = ["registration", "deviceId", "driver", "latitude", "longitude", "speed", "engine", "heading", "gpsSignal", "gprs", "positionSource", "positionTimestamp"] as const;

function isSourceFieldSnapshot(value: unknown): value is ForthSourceFieldSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const snapshot = value as Record<string, unknown>;
  return ["missing", "null", "empty", "string", "number", "boolean", "unsupported"].includes(String(snapshot.shape)) &&
    (snapshot.value === null || typeof snapshot.value === "string" || typeof snapshot.value === "boolean" || (typeof snapshot.value === "number" && Number.isFinite(snapshot.value))) &&
    typeof snapshot.truncated === "boolean";
}

function isFleetTrackingData(value: unknown): value is ForthFleetTrackingData {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  return ["not_configured", "connected", "failed"].includes(String(data.connectionStatus)) &&
    Array.isArray(data.records) &&
    data.records.every((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
      const sourceAudit = (entry as Record<string, unknown>).sourceAudit;
      if (!sourceAudit || typeof sourceAudit !== "object" || Array.isArray(sourceAudit)) return false;
      const source = sourceAudit as Record<string, unknown>;
      return SOURCE_AUDIT_FIELDS.every((field) => isSourceFieldSnapshot(source[field]));
    }) &&
    (data.fetchedAt === null || typeof data.fetchedAt === "string");
}

function isCountObject(value: unknown): value is Record<string, number> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    Object.values(value as Record<string, unknown>).every((count) => Number.isInteger(count) && Number(count) >= 0);
}

function isStatusDiagnosticResult(value: unknown): value is StatusDiagnosticResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  const unknownSourceStrings = result.unknownPositionSourceStrings;
  const unknownSourceShape = unknownSourceStrings && typeof unknownSourceStrings === "object"
    ? unknownSourceStrings as Record<string, unknown>
    : null;
  return ["connected", "failed", "not_configured"].includes(String(result.connectionStatus)) &&
    Number.isInteger(result.recordCount) && Number(result.recordCount) >= 0 &&
    isCountObject(result.communications) &&
    isCountObject(result.positionFreshness) &&
    isCountObject(result.gpsSignal) &&
    isCountObject(result.positionQuality) &&
    isCountObject(result.speedAvailability) &&
    isCountObject(result.engineState) &&
    isCountObject(result.classificationReason) &&
    Boolean(result.positionSourceShape) &&
    typeof result.positionSourceShape === "object" &&
    isCountObject((result.positionSourceShape as Record<string, unknown>).canonicalField) &&
    Number.isInteger((result.positionSourceShape as Record<string, unknown>).alternateCandidateRecords) &&
    Number((result.positionSourceShape as Record<string, unknown>).alternateCandidateRecords) >= 0 &&
    isCountObject((result.positionSourceShape as Record<string, unknown>).alternateCandidateValues) &&
    Boolean(unknownSourceShape) &&
    Number.isInteger(unknownSourceShape!.unknownStringCount) &&
    Number(unknownSourceShape!.unknownStringCount) >= 0 &&
    Number.isInteger(unknownSourceShape!.returnedUniqueCount) &&
    Number(unknownSourceShape!.returnedUniqueCount) >= 0 &&
    Number(unknownSourceShape!.returnedUniqueCount) <= 20 &&
    Number.isInteger(unknownSourceShape!.notListedOccurrences) &&
    Number(unknownSourceShape!.notListedOccurrences) >= 0 &&
    Number.isInteger(unknownSourceShape!.rejectedOccurrences) &&
    Number(unknownSourceShape!.rejectedOccurrences) >= 0 &&
    Array.isArray(unknownSourceShape!.labels) &&
    unknownSourceShape!.labels.length <= 20 &&
    unknownSourceShape!.labels.every((entry) =>
      Boolean(entry) &&
      typeof entry === "object" &&
      typeof (entry as Record<string, unknown>).label === "string" &&
      Array.from((entry as Record<string, unknown>).label as string).length <= 80 &&
      Number.isInteger((entry as Record<string, unknown>).occurrences) &&
      Number((entry as Record<string, unknown>).occurrences) > 0
    ) &&
    (result.error === null || typeof result.error === "string");
}

function activityText(activity: ForthReportedActivity, copy: Copy) {
  if (activity === "driving") return copy.activityDriving;
  if (activity === "stopped_engine_on") return copy.activityStoppedEngineOn;
  if (activity === "stopped_engine_off") return copy.activityStoppedEngineOff;
  if (activity === "stopped_engine_unknown") return copy.activityStoppedEngineUnknown;
  return copy.activityUnavailable;
}

function activityStyle(activity: ForthReportedActivity) {
  if (activity === "driving") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (activity === "stopped_engine_on") return "border-amber-200 bg-amber-50 text-amber-900";
  if (activity === "stopped_engine_off") return "border-indigo-200 bg-indigo-50 text-indigo-800";
  if (activity === "stopped_engine_unknown") return "border-slate-300 bg-slate-100 text-slate-700";
  return "border-slate-200 bg-slate-100 text-slate-700";
}

function accuracyFieldLabel(field: ForthAccuracyField, copy: Copy) {
  const labels: Record<ForthAccuracyField, string> = {
    registration: copy.registration,
    device_id: copy.device,
    driver: copy.driver,
    speed: copy.speed,
    engine: copy.engine,
    latitude: copy.accuracyLatitude,
    longitude: copy.accuracyLongitude,
    heading: copy.heading,
    gps_signal: copy.gps,
    gprs: copy.gprs,
    position_source: copy.positionSource,
    position_time: copy.timestamp,
    retrieval_time: copy.lastSync,
    activity_status: copy.accuracyActivityStatus
  };
  return labels[field];
}

function accuracyWarningLabel(warning: ForthNormalizationWarning, copy: Copy) {
  const labels: Record<ForthNormalizationWarning, string> = {
    registration_missing: copy.warningRegistrationMissing,
    device_id_missing: copy.warningDeviceMissing,
    driver_not_displayable: copy.warningDriverFiltered,
    speed_missing: copy.warningSpeedMissing,
    speed_invalid: copy.warningSpeedInvalid,
    engine_unavailable: copy.warningEngineUnknown,
    coordinates_missing: copy.warningCoordinatesMissing,
    coordinates_invalid: copy.warningCoordinatesInvalid,
    heading_invalid: copy.warningHeadingInvalid,
    gps_signal_unknown: copy.warningGpsUnknown,
    gprs_unknown: copy.warningGprsUnknown,
    position_time_stale: copy.warningTimestampStale,
    position_time_unavailable: copy.warningTimestampUnknown,
    position_source_unknown: copy.warningSourceUnknown,
    source_value_truncated: copy.warningTruncated
  };
  return labels[warning];
}

function sourceAuditValue(snapshot: ForthSourceFieldSnapshot, copy: Copy) {
  if (snapshot.shape === "missing") return copy.accuracyMissing;
  if (snapshot.shape === "null") return copy.accuracyNull;
  if (snapshot.shape === "empty") return copy.accuracyEmpty;
  if (snapshot.shape === "unsupported") return copy.accuracyUnsupported;
  return (
    <span className="inline-flex max-w-full flex-wrap items-baseline gap-1">
      <code className="break-all rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-800">
        {typeof snapshot.value === "string" ? JSON.stringify(snapshot.value) : String(snapshot.value)}
      </code>
      {snapshot.truncated ? <span className="text-[10px] text-amber-800">{copy.accuracyTruncated}</span> : null}
    </span>
  );
}

function normalizedAccuracyValue(
  field: ForthAccuracyField,
  normalized: string | null,
  record: ForthFleetTrackingRecord,
  fetchedAt: string | null,
  copy: Copy,
  language: "en" | "th"
) {
  if (field === "engine") return record.engineOn === null ? copy.unknownValue : record.engineOn ? copy.engineOn : copy.engineOff;
  if (field === "gps_signal") return record.gpsConnectivity === "connected" ? copy.available : record.gpsConnectivity === "disconnected" ? copy.gpsNoFix : copy.unknownValue;
  if (field === "gprs") return record.gprsConnectivity === "connected" ? copy.online : record.gprsConnectivity === "disconnected" ? copy.offlineStatus : copy.unknownValue;
  if (field === "position_source") return <span>{gpsConfidenceLabel(record, copy)}{record.positionSource ? <span className="mt-1 block text-[11px] text-slate-500">{record.positionSource}</span> : null}</span>;
  if (field === "position_time") return <span>{formatForthTrackingTime(record.lastGpsTimestamp, language) ?? timestampStatusLabel(record, copy)}{record.lastGpsTimestamp ? <span className="mt-1 block text-[10px] font-normal text-slate-500">{record.lastGpsTimestamp} · {timestampStatusLabel(record, copy)}</span> : null}</span>;
  if (field === "retrieval_time") return <span>{formatForthTrackingTime(fetchedAt, language) ?? copy.unknownValue}{fetchedAt ? <span className="mt-1 block text-[10px] font-normal text-slate-500">{fetchedAt}</span> : null}</span>;
  if (field === "activity_status") return <span>{activityText(getForthReportedActivity(record), copy)}<span className="mt-1 block text-[10px] font-normal text-slate-500">{copy.accuracyActivityDerived}</span></span>;
  return normalized ?? copy.unknownValue;
}

function ActivityPill({ activity, copy }: { activity: ForthReportedActivity; copy: Copy }) {
  return (
    <span className={"inline-flex min-h-6 items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold leading-none " + activityStyle(activity)}>
      {activityText(activity, copy)}
    </span>
  );
}

const FleetVehicleRow = memo(function FleetVehicleRow({
  record,
  recordKey,
  active,
  copy,
  language,
  onSelect
}: {
  record: ForthFleetTrackingRecord;
  recordKey: string;
  active: boolean;
  copy: Copy;
  language: "en" | "th";
  onSelect: (key: string) => void;
}) {
  const activity = getForthReportedActivity(record);
  const updateTime = formatForthRelativeAge(record.lastGpsTimestamp, Date.now(), language);
  const exactUpdateTime = formatForthTrackingTime(record.lastGpsTimestamp, language);
  const accessibleUpdateTime = updateTime
    ? `${updateTime}${exactUpdateTime ? `. ${copy.exactPositionTime}: ${exactUpdateTime}` : ""}`
    : copy.unknownValue;

  return (
    <button type="button" aria-pressed={active} onClick={() => onSelect(recordKey)} className={`block w-full rounded-xl border px-2.5 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 ${active ? "border-violet-300 bg-violet-50/80 shadow-[0_2px_10px_rgba(91,35,142,0.1)]" : "border-slate-200/80 bg-white hover:border-violet-200 hover:bg-slate-50/70"}`}>
      <span className="flex min-w-0 items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[14px] font-bold tracking-tight text-slate-950">{record.vehicleRegistration || copy.unknownValue}</span>
        <ActivityPill activity={activity} copy={copy} />
      </span>
      <span className="mt-1 flex min-w-0 items-center justify-between gap-2">
        <span className="inline-flex items-baseline gap-1.5 text-slate-950"><Gauge className="h-3.5 w-3.5 self-center text-slate-400" /><strong className="text-base leading-5">{record.speed === null ? "—" : record.speed}</strong><span className="text-[10px] text-slate-500">km/h</span></span>
        <span className={`inline-flex max-w-[58%] min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-semibold ${record.engineOn === true ? "bg-amber-50 text-amber-900" : record.engineOn === false ? "bg-indigo-50 text-indigo-800" : "bg-slate-100 text-slate-600"}`}><Activity className="h-3 w-3 shrink-0 opacity-70" /><span className="truncate">{record.engineOn === null ? copy.unknownValue : record.engineOn ? copy.engineOnLabel : copy.engineOffLabel}</span></span>
      </span>
      <span className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1 text-[10px] leading-4">
        <span title={exactUpdateTime ?? undefined} aria-label={accessibleUpdateTime} className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-slate-600"><Clock3 className="h-3 w-3 shrink-0 text-slate-400" /><span>{updateTime ?? copy.unknownValue}</span></span>
        {record.timestampStatus === "stale" ? <span className="rounded-full bg-amber-50 px-1.5 py-0.5 font-semibold text-amber-900">{copy.stale}</span> : null}
        <span title={record.gprsConnectivity === "connected" ? copy.online : record.gprsConnectivity === "disconnected" ? copy.offlineStatus : copy.unknownValue} className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-semibold ${record.gprsConnectivity === "connected" ? "bg-emerald-50 text-emerald-800" : record.gprsConnectivity === "disconnected" ? "bg-rose-50 text-rose-800" : "bg-slate-100 text-slate-600"}`}><Wifi className="h-3 w-3" /><span>{record.gprsConnectivity === "connected" ? copy.online : record.gprsConnectivity === "disconnected" ? copy.offlineStatus : copy.unknownValue}</span></span>
        <span title={gpsConfidenceLabel(record, copy)} className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-semibold ${isForthGpsPositionVerified(record) ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}><MapPin className="h-3 w-3 shrink-0" /><span>{shortPositionQualityLabel(record, copy)}</span></span>
      </span>
    </button>
  );
});

function OverviewMetric({ label, value, icon, tone, active, disabled, onClick }: {
  label: string;
  value: string;
  icon: ReactNode;
  tone: "emerald" | "violet" | "amber" | "rose";
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const tones = {
    emerald: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    violet: "bg-violet-50 text-violet-700 ring-violet-100",
    amber: "bg-amber-50 text-amber-800 ring-amber-100",
    rose: "bg-rose-50 text-rose-700 ring-rose-100"
  };
  return (
    <button type="button" aria-pressed={active} onClick={onClick} disabled={disabled} className={`flex min-h-[58px] min-w-0 items-center gap-2 rounded-xl border bg-white px-2.5 py-2 text-left transition hover:border-violet-200 hover:bg-slate-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 disabled:cursor-not-allowed disabled:opacity-60 sm:px-3 ${active ? "border-violet-400 bg-violet-50/70 ring-1 ring-violet-200" : "border-slate-200/90"}`}>
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ${tones[tone]}`}>{icon}</span>
      <div className="min-w-0">
        <p className="truncate text-[10px] font-semibold text-slate-500 sm:text-[11px]">{label}</p>
        <p className="text-xl font-bold leading-5 tracking-tight text-slate-950">{value}</p>
      </div>
    </button>
  );
}

function recordLocationLabel(record: ForthFleetTrackingRecord, copy: Copy) {
  if (record.coordinateStatus === "missing") return copy.missingLocation;
  if (record.coordinateStatus === "invalid") return copy.invalidLocation;
  if (record.positionQuality === "gps") return `${copy.gpsQuality} · ${record.timestampStatus === "stale" ? copy.stale : record.timestampStatus === "current" ? copy.current : copy.unknownValue}`;
  if (record.positionQuality === "no_gps") return copy.noGpsQuality;
  if (record.positionQuality === "wifi") return copy.wifiQuality;
  if (record.positionQuality === "lbs") return copy.lbsQuality;
  if (record.positionQuality === "other") return copy.otherQuality;
  return copy.unknownQuality;
}

function gpsConfidenceLabel(record: ForthFleetTrackingRecord, copy: Copy) {
  if (isForthGpsPositionVerified(record)) return copy.gpsPositionVerified;
  if (record.positionQuality === "no_gps") return copy.noGpsQuality;
  return copy.gpsPositionUnverified + " · " + recordLocationLabel(record, copy);
}

function shortPositionQualityLabel(record: ForthFleetTrackingRecord, copy: Copy) {
  if (record.positionQuality === "gps") return copy.gpsQuality;
  if (record.positionQuality === "no_gps") return "No GPS";
  if (record.positionQuality === "wifi") return "Wi-Fi";
  if (record.positionQuality === "lbs") return "LBS";
  if (record.positionQuality === "other") return copy.otherQuality;
  return copy.unknownQuality;
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
  const [requestFailureReason, setRequestFailureReason] = useState<TrackingRequestFailure>("network");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [accuracySearch, setAccuracySearch] = useState("");
  const [filter, setFilter] = useState<ForthFleetFilter>("all");
  const [sort, setSort] = useState<ForthFleetSort>("registration");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileListOpen, setMobileListOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false);
  const [mapCommand, setMapCommand] = useState<MapViewCommand>({ type: "fit", sequence: 0 });
  const [statusDiagnostic, setStatusDiagnostic] = useState<StatusDiagnosticResult | null>(null);
  const [statusDiagnosticState, setStatusDiagnosticState] = useState<StatusDiagnosticUiState>("checking");
  const [statusDiagnosticFailure, setStatusDiagnosticFailure] = useState<{
    reason: ForthStatusDiagnosticFailure;
    attemptUsed: boolean;
    httpStatus?: number;
  } | null>(null);
  const [statusDiagnosticConfirmationOpen, setStatusDiagnosticConfirmationOpen] = useState(false);
  const refreshRef = useRef<() => Promise<void>>(async () => undefined);
  const statusDiagnosticRunnerRef = useRef<StatusDiagnosticRunner | null>(null);
  const statusDiagnosticTriggerRef = useRef<HTMLButtonElement | null>(null);
  const diagnosticsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const diagnosticsCloseRef = useRef<HTMLButtonElement | null>(null);
  const diagnosticsDialogRef = useRef<HTMLElement | null>(null);
  const mobileListTriggerRef = useRef<HTMLButtonElement | null>(null);
  const mobileListSearchRef = useRef<HTMLInputElement | null>(null);
  const mobileListDialogRef = useRef<HTMLElement | null>(null);
  const diagnosticsWasOpenRef = useRef(false);
  const mobileListWasOpenRef = useRef(false);
  const statusDiagnosticCancelRef = useRef<HTMLButtonElement | null>(null);
  const statusDiagnosticDialogRef = useRef<HTMLDivElement | null>(null);
  const statusDiagnosticMessageRef = useRef<HTMLParagraphElement | null>(null);
  const statusDiagnosticReturnFocusRef = useRef<HTMLElement | null>(null);
  const restoreStatusDiagnosticFocusRef = useRef(false);
  const statusDiagnosticConfirmationReturnStateRef = useRef<"ready" | "failed">("ready");
  const statusDiagnosticConfirmStartedRef = useRef(false);
  const statusDiagnosticInteractedRef = useRef(false);

  useEffect(() => {
    if (diagnosticsOpen) {
      diagnosticsWasOpenRef.current = true;
      diagnosticsCloseRef.current?.focus();
    } else if (diagnosticsWasOpenRef.current) {
      diagnosticsWasOpenRef.current = false;
      diagnosticsTriggerRef.current?.focus();
    }
  }, [diagnosticsOpen]);

  useEffect(() => {
    if (mobileListOpen) {
      mobileListWasOpenRef.current = true;
      mobileListSearchRef.current?.focus();
    } else if (mobileListWasOpenRef.current) {
      mobileListWasOpenRef.current = false;
      mobileListTriggerRef.current?.focus();
    }
  }, [mobileListOpen]);

  useEffect(() => {
    if (!diagnosticsOpen && !mobileListOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (statusDiagnosticConfirmationOpen) return;
        if (diagnosticsOpen) {
          setDiagnosticsOpen(false);
        } else {
          setMobileListOpen(false);
        }
        return;
      }
      if (mobileListOpen && !diagnosticsOpen && event.key === "Tab") {
        const dialog = mobileListDialogRef.current;
        const focusable = dialog?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), summary, [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (!focusable?.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
        return;
      }
      if (!diagnosticsOpen || statusDiagnosticConfirmationOpen || event.key !== "Tab") return;
      const dialog = diagnosticsDialogRef.current;
      const focusable = dialog?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), summary, [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [diagnosticsOpen, mobileListOpen, statusDiagnosticConfirmationOpen]);

  const applyFleetFilter = (nextFilter: ForthFleetFilter) => {
    setFilter(nextFilter);
    if (!selectedKey) return;
    const matchingRecords = filterForthFleetRecords(data?.records ?? [], "", nextFilter);
    const selectionIsVisible = matchingRecords.some((record, index) => getForthFleetRecordKey(record, index) === selectedKey);
    if (!selectionIsVisible) {
      setSelectedKey(null);
      setInspectorOpen(false);
      setMobileInspectorOpen(false);
    }
  };

  const focusVehicle = useCallback((key: string) => {
    setMobileListOpen(false);
    setSelectedKey(key);
    setInspectorOpen(true);
    setMobileInspectorOpen(true);
    setMapCommand((current) => ({ type: "focus", sequence: current.sequence + 1, key }));
  }, []);

  const fitAllVehicles = () => {
    setSelectedKey(null);
    setInspectorOpen(false);
    setMobileInspectorOpen(false);
    setMapCommand((current) => ({ type: "fit", sequence: current.sequence + 1 }));
  };

  const toggleVehicleList = () => {
    if (window.matchMedia("(min-width: 1280px)").matches) {
      setSidebarOpen((open) => !open);
      return;
    }
    setMobileListOpen(true);
  };

  if (!statusDiagnosticRunnerRef.current) {
    statusDiagnosticRunnerRef.current = createForthStatusDiagnosticRunner<StatusDiagnosticResult>({
      storage: {
        read: () => window.sessionStorage.getItem(FORTH_STATUS_DIAGNOSTIC_SESSION_KEY),
        write: (value) => window.sessionStorage.setItem(FORTH_STATUS_DIAGNOSTIC_SESSION_KEY, value)
      },
      getAccessToken: async () => {
        try {
          const { data: authData, error: authError } = await supabase.auth.getSession();
          return authError ? null : authData.session?.access_token ?? null;
        } catch {
          return null;
        }
      },
      isValidResult: isStatusDiagnosticResult
    });
  }
  const statusDiagnosticRunner = statusDiagnosticRunnerRef.current;

  useEffect(() => {
    setStatusDiagnosticState(statusDiagnosticRunner.isAttemptUsed() ? "previously_attempted" : "ready");
  }, [statusDiagnosticRunner]);

  useEffect(() => {
    if (statusDiagnosticConfirmationOpen) {
      statusDiagnosticCancelRef.current?.focus();
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          event.preventDefault();
          setStatusDiagnosticConfirmationOpen(false);
          setStatusDiagnosticState(statusDiagnosticConfirmationReturnStateRef.current);
          return;
        }
        if (event.key !== "Tab") return;
        const dialog = statusDiagnosticDialogRef.current;
        const focusable = dialog?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (!focusable?.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      };
      document.addEventListener("keydown", onKeyDown);
      return () => document.removeEventListener("keydown", onKeyDown);
    }
    if (restoreStatusDiagnosticFocusRef.current) {
      restoreStatusDiagnosticFocusRef.current = false;
      statusDiagnosticReturnFocusRef.current?.focus();
    }
  }, [statusDiagnosticConfirmationOpen]);

  useEffect(() => {
    if (statusDiagnosticInteractedRef.current &&
      ["completed", "failed", "previously_attempted"].includes(statusDiagnosticState)) {
      statusDiagnosticMessageRef.current?.focus();
    }
  }, [statusDiagnosticState]);

  const runStatusDiagnostic = async () => {
    if (!statusDiagnosticConfirmationOpen || statusDiagnosticConfirmStartedRef.current) return;
    statusDiagnosticConfirmStartedRef.current = true;
    restoreStatusDiagnosticFocusRef.current = false;
    setStatusDiagnosticConfirmationOpen(false);
    setStatusDiagnosticFailure(null);
    setStatusDiagnostic(null);
    setStatusDiagnosticState("running");

    try {
      const outcome = await statusDiagnosticRunner.run();
      if (outcome.kind === "completed") {
        setStatusDiagnostic(outcome.result);
        setStatusDiagnosticState("completed");
      } else if (outcome.reason === "already_attempted") {
        setStatusDiagnosticFailure({ reason: outcome.reason, attemptUsed: true });
        setStatusDiagnosticState("previously_attempted");
      } else {
        setStatusDiagnosticFailure({
          reason: outcome.reason,
          attemptUsed: outcome.attemptUsed,
          httpStatus: outcome.httpStatus
        });
        setStatusDiagnosticState("failed");
      }
    } catch {
      setStatusDiagnosticFailure({
        reason: "network_error",
        attemptUsed: statusDiagnosticRunner.isAttemptUsed()
      });
      setStatusDiagnosticState("failed");
    } finally {
      statusDiagnosticConfirmStartedRef.current = false;
    }
  };

  const openStatusDiagnosticConfirmation = () => {
    const mayStart = statusDiagnosticState === "ready" ||
      (statusDiagnosticState === "failed" && statusDiagnosticFailure?.attemptUsed === false);
    if (!mayStart) return;
    if (statusDiagnosticRunner.isAttemptUsed()) {
      setStatusDiagnosticState("previously_attempted");
      return;
    }
    statusDiagnosticInteractedRef.current = true;
    statusDiagnosticConfirmationReturnStateRef.current =
      statusDiagnosticState === "failed" ? "failed" : "ready";
    statusDiagnosticReturnFocusRef.current = statusDiagnosticTriggerRef.current;
    restoreStatusDiagnosticFocusRef.current = true;
    setStatusDiagnosticConfirmationOpen(true);
    setStatusDiagnosticState("awaiting_confirmation");
  };

  const cancelStatusDiagnosticConfirmation = () => {
    setStatusDiagnosticConfirmationOpen(false);
    setStatusDiagnosticState(statusDiagnosticConfirmationReturnStateRef.current);
  };

  const closeDiagnostics = () => {
    if (statusDiagnosticConfirmationOpen) cancelStatusDiagnosticConfirmation();
    setDiagnosticsOpen(false);
  };

  useEffect(() => {
    let active = true;
    let inFlight = false;
    let requestController: AbortController | null = null;

    const load = async () => {
      if (!active || inFlight) return;
      inFlight = true;
      requestController = new AbortController();
      let timedOut = false;
      let failureReason: TrackingRequestFailure = "network";
      const timeout = window.setTimeout(() => {
        timedOut = true;
        requestController?.abort();
      }, REQUEST_TIMEOUT_MS);
      setRefreshing(true);

      try {
        let authData: Awaited<ReturnType<typeof supabase.auth.getSession>>["data"];
        let authError: Awaited<ReturnType<typeof supabase.auth.getSession>>["error"];
        try {
          ({ data: authData, error: authError } = await supabase.auth.getSession());
        } catch {
          failureReason = "session";
          throw new Error("session_unavailable");
        }
        if (authError || !authData.session?.access_token) {
          failureReason = "session";
          throw new Error("session_unavailable");
        }
        if (!active) return;

        const response = await fetch("/api/admin/forth-tracking/vehicles", {
          method: "GET",
          cache: "no-store",
          signal: requestController.signal,
          headers: { Authorization: `Bearer ${authData.session.access_token}` }
        });
        if (!response.ok) {
          failureReason = response.status === 401 || response.status === 403
            ? "authorization"
            : response.status >= 500 ? "upstream" : "network";
          throw new Error("request_unavailable");
        }
        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          failureReason = "invalid_response";
          throw new Error("invalid_response");
        }
        if (!isFleetTrackingData(payload)) {
          failureReason = "invalid_response";
          throw new Error("invalid_response");
        }
        if (active) {
          if (payload.connectionStatus === "connected" && payload.fetchedAt) {
            setLastSuccessfulRefreshAt(payload.fetchedAt);
          }
          setData(payload);
          setRequestError(false);
          setRequestFailureReason("network");
          setSelectedKey((current) => current && payload.records.some((record, index) => getForthFleetRecordKey(record, index) === current) ? current : null);
        }
      } catch {
        if (active) {
          setData(null);
          setRequestError(true);
          setRequestFailureReason(timedOut ? "timeout" : failureReason);
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

  const connected = !requestError && data?.connectionStatus === "connected";
  const summary = useMemo(() => summarizeForthFleet(data?.records ?? []), [data?.records]);
  const recordKeysByReference = useMemo(() => {
    const keys = new Map<ForthFleetTrackingRecord, string>();
    for (const [index, record] of (data?.records ?? []).entries()) {
      keys.set(record, getForthFleetRecordKey(record, index));
    }
    return keys;
  }, [data?.records]);
  const visibleRecords = useMemo(
    () => sortForthFleetRecords(filterForthFleetRecords(data?.records ?? [], search, filter), sort),
    [data?.records, filter, search, sort]
  );
  const mapRecords = useMemo(
    () => filterForthFleetRecords(data?.records ?? [], "", filter),
    [data?.records, filter]
  );
  const mapInitialFrame = useMemo(
    () => getForthFleetMapInitialFrame(getForthFleetMapRecords(mapRecords).map(({ position }) => position)),
    [mapRecords]
  );
  const unplottableRecordCount = Math.max(0, mapRecords.length - mapInitialFrame.allPositions.length);
  const accuracyRecords = useMemo(() => {
    const query = accuracySearch.trim().toLocaleLowerCase();
    const records = data?.records ?? [];
    return sortForthFleetRecords(records.filter((record) => {
      if (!query) return true;
      return [
        record.vehicleRegistration,
        record.gpsDeviceId,
        record.reportedDriver,
        typeof record.sourceAudit.registration.value === "string" ? record.sourceAudit.registration.value : null,
        typeof record.sourceAudit.deviceId.value === "string" ? record.sourceAudit.deviceId.value : null
      ].some((value) => value?.toLocaleLowerCase().includes(query));
    }), "registration");
  }, [accuracySearch, data?.records]);
  const selectedRecord = useMemo(() => {
    if (!data || !selectedKey) return null;
    return findForthFleetRecord(data.records, selectedKey);
  }, [data, selectedKey]);
  const lastGpsUpdate = formatForthTrackingTime(summary.latestCurrentGpsPosition, language);
  const selectedHasMapPosition = selectedRecord ? getForthFleetMapRecords([selectedRecord]).length > 0 : false;
  const lastChecked = formatForthTrackingTime(
    lastSuccessfulRefreshAt ?? (data?.connectionStatus === "connected" ? data.fetchedAt : null),
    language
  );
  const lastRefreshAge = formatForthRelativeAge(
    lastSuccessfulRefreshAt ?? (data?.connectionStatus === "connected" ? data.fetchedAt : null),
    Date.now(),
    language
  );
  const mapCopy = useMemo(() => ({
    driving: copy.mapMoving,
    stopped: copy.mapParked,
    unavailable: copy.mapUnknown,
    gpsVerified: copy.gpsPositionVerified,
    notGpsVerified: copy.gpsPositionUnverified,
    clusterUnverified: copy.mapClusterUnverified,
    clusterVerified: copy.mapClusterVerified,
    clusterDriving: copy.mapClusterDriving,
    clusterStopped: copy.mapClusterStopped,
    clusterUnavailable: copy.mapClusterUnavailable,
    engineOn: copy.engineOn,
    engineOff: copy.engineOff,
    unknownValue: copy.unknownValue,
    noPositions: copy.noPositions,
    loading: copy.mapLoading,
    mapUnavailable: copy.mapUnavailable,
    mapRegionLabel: copy.mapRegionLabel,
    openDetails: copy.openDetails
  }), [copy]);

  const trackingMessage = requestError
    ? requestFailureReason === "session"
      ? copy.requestSessionFailure
      : requestFailureReason === "authorization"
        ? copy.requestAuthorizationFailure
        : requestFailureReason === "timeout"
          ? copy.requestTimeoutFailure
          : requestFailureReason === "upstream"
            ? copy.requestUpstreamFailure
            : requestFailureReason === "invalid_response"
              ? copy.requestInvalidResponseFailure
              : copy.requestFailure
    : data?.error?.message ?? copy.failureBody;
  const diagnosticStateLabels: Record<StatusDiagnosticUiState, string> = {
    checking: copy.diagnosticStateChecking,
    ready: copy.diagnosticStateReady,
    awaiting_confirmation: copy.diagnosticStateAwaiting,
    running: copy.diagnosticStateRunning,
    completed: copy.diagnosticStateCompleted,
    failed: copy.diagnosticStateFailed,
    previously_attempted: copy.diagnosticStatePreviouslyAttempted
  };
  const diagnosticStatusBody = statusDiagnosticState === "checking"
    ? copy.diagnosticStateChecking
    : statusDiagnosticState === "ready"
      ? copy.diagnosticReadyBody
      : statusDiagnosticState === "awaiting_confirmation"
        ? copy.diagnosticAwaitingBody
        : statusDiagnosticState === "running"
          ? copy.diagnosticRunningBody
          : statusDiagnosticState === "completed"
            ? copy.diagnosticCompletedBody
            : statusDiagnosticState === "previously_attempted"
              ? copy.diagnosticPreviouslyAttemptedBody
              : statusDiagnosticFailure?.reason === "session_unavailable"
                ? copy.diagnosticSessionError
                : statusDiagnosticFailure?.reason === "unauthorized"
                  ? copy.diagnosticUnauthorizedError
                  : statusDiagnosticFailure?.reason === "forbidden"
                    ? copy.diagnosticForbiddenError
                    : statusDiagnosticFailure?.reason === "http_error"
                      ? copy.diagnosticHttpError + (statusDiagnosticFailure.httpStatus ? " (HTTP " + statusDiagnosticFailure.httpStatus + ")" : "")
                      : statusDiagnosticFailure?.reason === "network_error"
                        ? copy.diagnosticNetworkError
                        : statusDiagnosticFailure?.reason === "invalid_response"
                          ? copy.diagnosticInvalidResponseError
                          : copy.diagnosticDuplicateError;
  const diagnosticCanStart = statusDiagnosticState === "ready" ||
    (statusDiagnosticState === "failed" && statusDiagnosticFailure?.attemptUsed === false);
  const diagnosticButtonLabel = statusDiagnosticState === "checking"
    ? copy.diagnosticStateChecking + "…"
    : statusDiagnosticState === "awaiting_confirmation"
      ? copy.diagnosticStateAwaiting
      : statusDiagnosticState === "running"
        ? copy.diagnosticStateRunning + "…"
        : statusDiagnosticState === "completed"
          ? copy.diagnosticStateCompleted
          : statusDiagnosticState === "previously_attempted" ||
              (statusDiagnosticState === "failed" && statusDiagnosticFailure?.attemptUsed)
            ? copy.diagnosticStatePreviouslyAttempted
            : statusDiagnosticState === "failed"
              ? copy.diagnosticRetryButton
              : copy.diagnosticButton;
  const diagnosticStateClass = statusDiagnosticState === "completed"
    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
    : statusDiagnosticState === "failed" || statusDiagnosticState === "previously_attempted"
      ? "border-rose-200 bg-rose-50 text-rose-800"
      : statusDiagnosticState === "running" || statusDiagnosticState === "awaiting_confirmation"
        ? "border-violet-200 bg-violet-50 text-violet-800"
        : "border-slate-200 bg-slate-50 text-slate-700";

  return (
    <main className="forth-tracking-workspace mx-auto w-full max-w-[1920px] px-3 pb-6 pt-3 sm:px-5 lg:px-6">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 shadow-[0_4px_16px_rgba(15,23,42,0.035)] sm:px-4">
        <div className="min-w-0">
          <h1 className="text-base font-bold tracking-tight text-slate-950 sm:text-lg">{copy.title}</h1>
          <p className="hidden truncate text-[10px] leading-4 text-slate-500 sm:block">{copy.description} · {copy.freshnessShort}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {lastRefreshAge ? <span title={lastChecked ?? undefined} className="hidden text-right text-[10px] leading-4 text-slate-500 sm:block">{copy.lastSync}<strong className="ml-1 font-semibold text-slate-700">{lastRefreshAge}</strong></span> : null}
          <span className={`inline-flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-semibold ${connected ? "border-emerald-200 bg-emerald-50 text-emerald-800" : data?.connectionStatus === "not_configured" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-slate-200 bg-white text-slate-600"}`}>
            {connected ? <CheckCircle2 className="h-4 w-4" /> : data?.connectionStatus === "not_configured" ? <AlertTriangle className="h-4 w-4" /> : <Signal className="h-4 w-4" />}
            {connected ? copy.connected : data?.connectionStatus === "not_configured" ? copy.disconnected : data?.connectionStatus === "failed" || requestError ? copy.unavailable : copy.mapLoading}
          </span>
          <button
            type="button"
            className="btn-secondary min-h-10 justify-center gap-1.5 px-2.5 py-1.5 text-[11px]"
            onClick={() => void refreshRef.current()}
            disabled={refreshing || loading}
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? copy.refreshing : copy.refresh}
          </button>
          {connected && can("business:read") ? <button ref={diagnosticsTriggerRef} type="button" className="btn-secondary min-h-10 justify-center gap-1.5 px-2.5 py-1.5 text-[11px]" onClick={() => setDiagnosticsOpen(true)}>
            <Activity className="h-3.5 w-3.5" />{language === "th" ? "การวินิจฉัย" : "Diagnostics"}
          </button> : null}
        </div>
      </header>

      {data?.connectionStatus === "not_configured" || data?.connectionStatus === "failed" || requestError ? (
        <section className={`forth-tracking-alert flex shrink-0 items-center gap-2 rounded-lg border px-2.5 py-1.5 ${data?.connectionStatus === "not_configured" ? "border-amber-200 bg-amber-50/80" : "border-rose-200 bg-rose-50/80"}`} role="status">
          <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${data?.connectionStatus === "not_configured" ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700"}`}>
            {data?.connectionStatus === "not_configured" ? <SignalZero className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          </span>
          <div className="min-w-0 text-[11px] leading-4 text-slate-700">
            <strong className="mr-1 text-slate-900">{data?.connectionStatus === "not_configured" ? copy.configurationTitle : copy.failureTitle}</strong>
            <span>{data?.connectionStatus === "not_configured" ? copy.configurationBody : trackingMessage}</span>
            {requestError && lastChecked ? <span className="ml-1 text-slate-600">{copy.staleSnapshotHidden} {lastChecked}</span> : null}
          </div>
        </section>
      ) : null}

      <section aria-label={language === "th" ? "สรุปสถานะกองรถ" : "Fleet overview"} className="forth-tracking-kpi-scroll shrink-0 rounded-xl border border-slate-200 bg-white p-1.5 shadow-[0_3px_12px_rgba(15,23,42,0.025)]">
        <div className="forth-tracking-kpis flex gap-1.5">
        <OverviewMetric label={copy.total} value={connected ? String(summary.total) : "—"} tone="violet" icon={<Truck className="h-4 w-4" />} active={filter === "all"} disabled={!connected} onClick={() => applyFleetFilter("all")} />
        <OverviewMetric label={copy.moving} value={connected ? String(summary.reportedActivity.driving) : "—"} tone="emerald" icon={<Activity className="h-4 w-4" />} active={filter === "driving"} disabled={!connected} onClick={() => applyFleetFilter(filter === "driving" ? "all" : "driving")} />
        <OverviewMetric label={copy.parked} value={connected ? String(summary.reportedActivity.stopped) : "—"} tone="violet" icon={<Gauge className="h-4 w-4" />} active={filter === "stopped"} disabled={!connected} onClick={() => applyFleetFilter(filter === "stopped" ? "all" : "stopped")} />
        <OverviewMetric label={copy.engineOnStops} value={connected ? String(summary.reportedActivity.stoppedEngineOn) : "—"} tone="amber" icon={<Activity className="h-4 w-4" />} active={filter === "engine_on_stopped"} disabled={!connected} onClick={() => applyFleetFilter(filter === "engine_on_stopped" ? "all" : "engine_on_stopped")} />
        <OverviewMetric label={copy.offline} value={connected ? String(summary.communications.offline) : "—"} tone="rose" icon={<WifiOff className="h-4 w-4" />} active={filter === "offline"} disabled={!connected} onClick={() => applyFleetFilter(filter === "offline" ? "all" : "offline")} />
        <OverviewMetric label={copy.locationNotGpsVerified} value={connected ? String(summary.positionConfidence.notGpsVerified) : "—"} tone="amber" icon={<MapPin className="h-4 w-4" />} active={filter === "unverified"} disabled={!connected} onClick={() => applyFleetFilter(filter === "unverified" ? "all" : "unverified")} />
        </div>

      {connected && filter !== "all" ? (
        <div className="mt-1 flex min-h-6 items-center justify-end border-t border-slate-100 px-1 pt-1" role="group" aria-label={copy.attention}>
          <div className="flex items-center gap-1.5 text-[10px] text-slate-600" aria-live="polite">
                <span className="max-w-[40vw] truncate sm:max-w-none">{copy.activeFilter}: {({
                  all: copy.all,
                  online: copy.filterOnline,
                  driving: copy.drivingFilter,
                  stopped: copy.stoppedFilter,
                  unavailable: copy.unknown,
                  attention: copy.filterAttention,
                  offline: copy.filterOffline,
                  stale: copy.filterStale,
                  unverified: copy.filterUnverified,
                  engine_on_stopped: copy.filterEngineOnStopped
                } satisfies Record<ForthFleetFilter, string>)[filter]}</span>
                <button type="button" onClick={() => applyFleetFilter("all")} className="min-h-7 whitespace-nowrap rounded-md px-1.5 font-semibold text-violet-800 hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300">{copy.resetFilter}</button>
          </div>
        </div>
      ) : null}
      </section>

      <div className={`forth-tracking-grid relative grid grid-cols-1 items-stretch gap-2 ${sidebarOpen ? "xl:grid-cols-[minmax(0,2.35fr)_minmax(300px,0.85fr)]" : "xl:grid-cols-1"}`}>
        <section className="forth-map-panel surface-card order-1 min-w-0 overflow-hidden p-2 xl:col-start-1 xl:row-start-1" aria-labelledby="forth-live-map-title">
          <div className="mb-1.5 flex shrink-0 flex-wrap items-center justify-between gap-2 px-1 pt-0.5">
            <div className="min-w-0">
              <h2 id="forth-live-map-title" className="flex items-center gap-1.5 text-sm font-bold text-slate-950"><MapPinned className="h-4 w-4 shrink-0 text-violet-700" />{copy.mapTitle}</h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn-secondary hidden min-h-8 justify-center gap-1 px-2.5 py-1 text-[11px] xl:inline-flex" onClick={toggleVehicleList} aria-expanded={sidebarOpen} aria-controls="forth-vehicle-list">
                <List className="h-4 w-4" />{sidebarOpen ? (language === "th" ? "ซ่อนรายการ" : "Hide list") : (language === "th" ? "แสดงรายการ" : "Show list")}
              </button>
              <button ref={mobileListTriggerRef} type="button" className="btn-secondary min-h-10 justify-center gap-1 px-2.5 py-1 text-[11px] xl:hidden" onClick={toggleVehicleList} aria-expanded={mobileListOpen} aria-controls="forth-vehicle-list">
                <List className="h-4 w-4" />{copy.mapBrowseVehicles}
              </button>
              <button type="button" className="btn-primary min-h-10 justify-center gap-1 px-2.5 py-1 text-[11px]" onClick={fitAllVehicles} disabled={!connected}>
                <MapPinned className="h-4 w-4" />{copy.mapFitFleet}
              </button>
              {selectedRecord ? <button type="button" className="btn-secondary hidden min-h-8 justify-center gap-1 px-2.5 py-1 text-[11px] xl:inline-flex" onClick={() => setInspectorOpen((open) => !open)} aria-expanded={inspectorOpen}>
                {inspectorOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
                {inspectorOpen ? copy.mapHideInspector : copy.mapShowInspector}
              </button> : null}
              {selectedRecord ? <button type="button" className="btn-secondary min-h-10 justify-center gap-1 px-2.5 py-1 text-[11px] xl:hidden" onClick={() => setMobileInspectorOpen((open) => !open)} aria-expanded={mobileInspectorOpen}>
                {mobileInspectorOpen ? <X className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
                {mobileInspectorOpen ? copy.mapCloseInspector : copy.mapShowInspector}
              </button> : null}
            </div>
          </div>
          {connected ? (
            <ForthTrackingMap records={mapRecords} selectedKey={selectedKey} onSelect={focusVehicle} command={mapCommand} language={language} copy={mapCopy} />
          ) : (
            <div className="forth-map-viewport flex flex-col items-center justify-center rounded-[1.25rem] border border-dashed border-slate-200 bg-slate-50 px-5 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-violet-700 shadow-sm"><MapPin className="h-7 w-7" /></span>
              <p className="mt-4 max-w-sm text-sm font-medium leading-6 text-slate-600">{data?.connectionStatus === "not_configured" ? copy.configurationBody : copy.noPositions}</p>
            </div>
          )}
          {(filter === "all" && mapInitialFrame.outlierCount > 0) || unplottableRecordCount > 0 ? <p className="mt-1 shrink-0 rounded-md bg-amber-50 px-2 py-1 text-[10px] leading-4 text-amber-900">
            {filter === "all" && mapInitialFrame.outlierCount > 0 ? <span>{language === "th" ? `โฟกัสแผนที่ที่กลุ่มหลัก มีตำแหน่งรายงานอีก ${mapInitialFrame.outlierCount} จุดนอกกลุ่ม · กด “${copy.mapFitFleet}” เพื่อแสดงทั้งหมด` : `Initial view focuses on the main cluster; ${mapInitialFrame.outlierCount} reported position${mapInitialFrame.outlierCount === 1 ? " is" : "s are"} outside it. ${copy.mapFitFleet} shows all.`}</span> : null}
            {unplottableRecordCount > 0 ? <span className={filter === "all" && mapInitialFrame.outlierCount > 0 ? "ml-2" : ""}>{language === "th" ? `${unplottableRecordCount} รายงานไม่มีพิกัดที่ถูกต้อง แสดงข้อมูลต่อในรายการรถ` : `${unplottableRecordCount} report${unplottableRecordCount === 1 ? " has" : "s have"} missing or invalid coordinates and remains in the vehicle list.`}</span> : null}
          </p> : null}
          <div className="mt-1 flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-0.5 px-1 text-[10px] text-slate-500">
            <span className="inline-flex min-w-0 items-center gap-1.5"><MapPin className="h-3.5 w-3.5 shrink-0" />{language === "th" ? "ตำแหน่ง GPS ที่ยืนยันล่าสุด" : "Latest GPS-verified position"}: {lastGpsUpdate ?? copy.unknownValue} · {summary.currentGpsVerifiedPositions}/{summary.total}</span>
            <span>{language === "th" ? `รายงานตำแหน่งบนแผนที่ ${mapInitialFrame.allPositions.length} จุด · รีเฟรชทุก 60 วินาที` : `${mapInitialFrame.allPositions.length} plotted reports · refreshes every 60 seconds`}</span>
          </div>
          {connected ? (
            <div className="mt-1 flex shrink-0 flex-wrap gap-x-3 gap-y-1 border-t border-slate-100 px-1 pt-1 text-[9px] leading-4 text-slate-600 sm:text-[10px]" aria-label={language === "th" ? "คำอธิบายสัญลักษณ์แผนที่" : "Map marker legend"}>
              <span className="inline-flex items-center gap-1"><i aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-emerald-600" />{copy.mapMoving}</span>
              <span className="inline-flex items-center gap-1"><i aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-amber-600" />{copy.mapEngineOnStop}</span>
              <span className="inline-flex items-center gap-1"><i aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-indigo-600" />{copy.mapEngineOffStop}</span>
              <span className="inline-flex items-center gap-1"><i aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-slate-500" />{copy.mapEngineUnknownStop} / {copy.mapUnknown}</span>
              <span className="inline-flex items-center gap-1"><i aria-hidden="true" className="h-3 w-3 rounded-full border-2 border-dashed border-amber-700" />{copy.mapConfidence}</span>
              <span className="inline-flex items-center gap-1"><i aria-hidden="true" className="relative h-2.5 w-2.5 rounded-full border border-slate-800 after:absolute after:-right-1 after:-top-1 after:h-1.5 after:w-1.5 after:rounded-full after:border after:border-white after:bg-rose-600" />{copy.mapOfflineLegend}</span>
              <span className="inline-flex items-center gap-1"><i aria-hidden="true" className="h-3 w-3 rounded-full border-2 border-violet-700" />{copy.mapSelectedLegend}</span>
              <span className="basis-full text-slate-500">{copy.mapLabelHint}</span>
            </div>
          ) : null}
        </section>

        {mobileListOpen ? <button type="button" className="fixed inset-0 z-[840] bg-slate-950/45 xl:hidden" aria-label={language === "th" ? "ปิดรายการรถ" : "Close vehicle list"} onClick={() => setMobileListOpen(false)} /> : null}
        <section ref={mobileListDialogRef} id="forth-vehicle-list" className={`forth-vehicle-sidebar surface-card order-2 min-w-0 p-2.5 sm:p-3 xl:col-start-2 xl:row-start-1 ${mobileListOpen ? "fixed inset-y-0 right-0 z-[850] block w-[min(26rem,92vw)] overflow-hidden rounded-l-2xl rounded-r-none shadow-2xl" : "hidden"} ${sidebarOpen ? "xl:flex" : "xl:hidden"} xl:relative xl:inset-auto xl:z-auto xl:w-auto xl:rounded-2xl xl:shadow-none`} aria-labelledby="forth-vehicle-list-title" role={mobileListOpen ? "dialog" : undefined} aria-modal={mobileListOpen ? true : undefined}>
          <div className="flex shrink-0 items-start justify-between gap-3">
            <div>
              <h2 id="forth-vehicle-list-title" className="text-base font-bold text-slate-950">{copy.listTitle}</h2>
              <p className="mt-0.5 text-[10px] leading-4 text-slate-500">{copy.listDescription}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {connected ? <span className="rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-bold text-violet-800">{visibleRecords.length}</span> : null}
              <button type="button" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 xl:hidden" aria-label={language === "th" ? "ปิดรายการรถ" : "Close vehicle list"} onClick={() => setMobileListOpen(false)}><X className="h-4 w-4" /></button>
            </div>
          </div>

          <div className="forth-vehicle-controls mt-2 grid grid-cols-2 gap-1.5">
            <label className="relative col-span-2 block">
              <span className="sr-only">{copy.search}</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                ref={mobileListSearchRef}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={copy.search}
                type="search"
                className="min-h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-xs text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
              />
            </label>
            <label className="sr-only" htmlFor="forth-fleet-filter">{copy.filter}</label>
            <select id="forth-fleet-filter" aria-label={copy.filter} value={filter} onChange={(event) => applyFleetFilter(event.target.value as ForthFleetFilter)} className="min-h-10 min-w-0 rounded-xl border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100">
              <option value="all">{copy.all}</option>
              <option value="online">{copy.filterOnline}</option>
              <optgroup label={copy.activityGroup}>
                <option value="driving">{copy.drivingFilter}</option>
                <option value="stopped">{copy.stoppedFilter}</option>
                <option value="unavailable">{copy.unknown}</option>
              </optgroup>
              <optgroup label={copy.attentionGroup}>
                <option value="attention">{copy.filterAttention}</option>
                <option value="offline">{copy.filterOffline}</option>
                <option value="stale">{copy.filterStale}</option>
                <option value="unverified">{copy.filterUnverified}</option>
                <option value="engine_on_stopped">{copy.filterEngineOnStopped}</option>
              </optgroup>
            </select>
            <label className="sr-only" htmlFor="forth-fleet-sort">{copy.sort}</label>
            <select id="forth-fleet-sort" aria-label={copy.sort} value={sort} onChange={(event) => setSort(event.target.value as ForthFleetSort)} className="min-h-10 min-w-0 rounded-xl border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100">
              <option value="registration">{copy.sortRegistration}</option>
              <option value="speed_desc">{copy.sortSpeed}</option>
              <option value="updated_desc">{copy.sortUpdated}</option>
            </select>
          </div>
          <p className="forth-vehicle-count mt-1.5 text-[10px] text-slate-500">{copy.showingVehicles} {visibleRecords.length} {copy.ofVehicles} {summary.total} {copy.listCount}</p>

          <div className="forth-vehicle-results mt-2 space-y-1 pr-1">
            {connected && data.records.length === 0 ? <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">{copy.noVehicles}</div> : null}
            {connected && data.records.length > 0 && visibleRecords.length === 0 ? <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">{copy.noMatches}</div> : null}
            {connected ? visibleRecords.map((record) => {
              const key = recordKeysByReference.get(record);
              return key ? <FleetVehicleRow key={key} record={record} recordKey={key} active={key === selectedKey} copy={copy} language={language} onSelect={focusVehicle} /> : null;
            }) : null}
            {!connected && !loading && !requestError && data?.connectionStatus !== "not_configured" ? <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">{copy.failureBody}</div> : null}
            {loading && !data ? <div className="rounded-xl border border-slate-100 px-4 py-8 text-center text-sm text-slate-500">{copy.mapLoading}</div> : null}
          </div>
        </section>

        {selectedRecord ? (
          <>
            <section className={`surface-card min-w-0 p-3.5 sm:p-4 ${mobileInspectorOpen ? `fixed inset-x-2 bottom-2 top-auto z-[810] block max-h-[55dvh] overflow-y-auto shadow-2xl xl:absolute xl:inset-x-auto xl:bottom-3 ${sidebarOpen ? "xl:right-[calc(27%+0.75rem)]" : "xl:right-3"} xl:top-16 xl:z-[810] xl:w-[min(22rem,42%)] xl:max-h-[calc(100%-5rem)] xl:shadow-2xl` : "hidden"} ${inspectorOpen ? "xl:block" : "xl:hidden"}`} aria-labelledby="forth-vehicle-details-title">
            <>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-violet-700">{copy.detailsTitle}</p>
                  <h2 id="forth-vehicle-details-title" className="mt-1 text-lg font-bold tracking-tight text-slate-950">{selectedRecord.vehicleRegistration || copy.unknownValue}</h2>
                  {selectedRecord.reportedDriver ? <p className="mt-0.5 text-xs text-slate-500">{selectedRecord.reportedDriver}</p> : null}
                  <p className="mt-0.5 text-[10px] text-slate-400">{copy.device}: {selectedRecord.gpsDeviceId || copy.unknownValue}</p>
                </div>
                <div className="flex items-center gap-2">
                  <ActivityPill activity={getForthReportedActivity(selectedRecord)} copy={copy} />
                  <button type="button" aria-label={copy.mapCloseInspector} onClick={() => setMobileInspectorOpen(false)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 xl:hidden"><X className="h-4 w-4" /></button>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{copy.speed}</p>
                  <p className="mt-0.5 text-2xl font-bold leading-7 tracking-tight text-slate-950">{selectedRecord.speed === null ? "—" : selectedRecord.speed}<span className="ml-1 text-xs font-semibold text-slate-500">km/h</span></p>
                </div>
                <div className="min-w-0 text-right">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{copy.engine}</p>
                  <p className="mt-1 text-sm font-bold text-slate-800">{selectedRecord.engineOn === null ? copy.unknownValue : selectedRecord.engineOn ? copy.engineOnLabel : copy.engineOffLabel}</p>
                </div>
              </div>
              <p className="mt-1.5 text-[10px] text-slate-500">{copy.activityBasis} · {timestampStatusLabel(selectedRecord, copy)}</p>
              <span className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold ${isForthGpsPositionVerified(selectedRecord) ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}><MapPin className="h-3 w-3" />{gpsConfidenceLabel(selectedRecord, copy)}</span>

              <details className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2">
                <summary className="cursor-pointer text-xs font-semibold text-slate-800">{copy.locationSection}</summary>
                <div className="mt-2 space-y-2 border-t border-slate-100 pt-2 text-xs">
                  <p className="font-semibold text-slate-700">{copy.reportedCoordinates}: <span className="font-mono font-medium text-slate-600">{selectedRecord.coordinateStatus === "valid" && selectedRecord.latitude !== null && selectedRecord.longitude !== null ? `${selectedRecord.latitude.toFixed(5)}, ${selectedRecord.longitude.toFixed(5)}` : copy.noPosition}</span></p>
                  {!isForthGpsPositionVerified(selectedRecord) ? <p className="text-[10px] leading-4 text-amber-800">{copy.approximateCoordinatesNote}</p> : null}
                  <p className="font-semibold text-slate-700">{copy.heading}: <span className="font-medium text-slate-600">{selectedRecord.heading === null ? copy.unknownValue : `${selectedRecord.heading} ${copy.degrees}`}</span></p>
                  <button type="button" onClick={() => selectedKey && focusVehicle(selectedKey)} disabled={!selectedHasMapPosition} className="btn-secondary min-h-9 w-full justify-center gap-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"><MapPinned className="h-3.5 w-3.5" />{copy.focusOnMap}</button>
                </div>
              </details>

              <details className="mt-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
                <summary className="cursor-pointer text-xs font-semibold text-slate-800">{copy.connectionTimingSection}</summary>
                <div className="mt-2 grid gap-x-3 gap-y-2 border-t border-slate-100 pt-2 text-xs sm:grid-cols-2 2xl:grid-cols-1">
                  <p className="min-w-0"><span className="block text-[10px] font-semibold uppercase text-slate-500">{copy.communications}</span><span className="mt-0.5"><ConnectivityValue connected={selectedRecord.gprsConnectivity} copy={copy} /></span></p>
                  <p className="min-w-0"><span className="block text-[10px] font-semibold uppercase text-slate-500">{copy.gps}</span><span className="mt-0.5"><ConnectivityValue connected={selectedRecord.gpsConnectivity} copy={copy} connectedLabel={copy.available} disconnectedLabel={copy.gpsNoFix} /></span></p>
                  <p className="min-w-0"><span className="block text-[10px] font-semibold uppercase text-slate-500">{copy.lastVehicleUpdate}</span><span className="mt-0.5 block break-words text-slate-700">{formatForthTrackingTime(selectedRecord.lastGpsTimestamp, language) ?? copy.unknownValue} · {timestampStatusLabel(selectedRecord, copy)}</span></p>
                  <p className="min-w-0"><span className="block text-[10px] font-semibold uppercase text-slate-500">{copy.lastSync}</span><span className="mt-0.5 block break-words text-slate-700">{lastChecked ?? copy.unknownValue}</span></p>
                </div>
              </details>

              <details className="mt-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
                <summary className="cursor-pointer text-xs font-semibold text-slate-800">{copy.sourceSection}</summary>
                <div className="mt-2 space-y-2 border-t border-slate-100 pt-2 text-xs">
                  <p className="font-semibold text-slate-700">{copy.positionSource}: <span className="font-medium text-slate-600">{shortPositionQualityLabel(selectedRecord, copy)}</span></p>
                  {selectedRecord.positionQuality === "no_gps" ? <p className="text-[10px] leading-4 text-amber-800">{copy.noGpsSourceNote}</p> : null}
                </div>
              </details>
            </>
            </section>
          </>
        ) : null}
      </div>
      {connected && can("business:read") && diagnosticsOpen ? (
        <div className="fixed inset-0 z-[900] flex justify-end bg-slate-950/45">
          <button type="button" className="absolute inset-0" aria-label={language === "th" ? "ปิดการวินิจฉัย" : "Close diagnostics"} onClick={closeDiagnostics} />
          <aside ref={diagnosticsDialogRef} role="dialog" aria-modal="true" aria-labelledby="forth-diagnostics-title" className="relative z-[901] flex h-full w-full max-w-3xl flex-col border-l border-slate-200 bg-slate-50 shadow-2xl">
            <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-violet-700">{language === "th" ? "สิทธิ์สำนักงาน" : "Office access"}</p>
                <h2 id="forth-diagnostics-title" className="text-base font-bold text-slate-950">{language === "th" ? "การวินิจฉัยการติดตาม" : "Tracking diagnostics"}</h2>
              </div>
              <button ref={diagnosticsCloseRef} type="button" className="btn-secondary min-h-9 justify-center gap-1.5 px-3 text-xs" onClick={closeDiagnostics}><X className="h-4 w-4" />{language === "th" ? "ปิด" : "Close"}</button>
            </header>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 sm:p-5">
        <details className="rounded-2xl border border-slate-200 bg-white px-4 py-3 sm:px-5">
          <summary className="cursor-pointer text-sm font-semibold text-slate-700">{copy.accuracyTitle}</summary>
          <section className="mt-4 space-y-4" aria-label={copy.accuracyTitle}>
            <div className="space-y-2 text-xs leading-5 text-slate-600">
              <p>{copy.accuracyIntro}</p>
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-950"><strong>{copy.accuracyActivityStatus}:</strong> {copy.accuracyActivityNotMapped} {copy.accuracyActivityDerived}</p>
              <p>{copy.accuracySignalExplanation}</p>
              <p>{copy.accuracySpeedUnitNote}</p>
            </div>
            <label className="block max-w-lg">
              <span className="sr-only">{copy.accuracySearch}</span>
              <span className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  value={accuracySearch}
                  onChange={(event) => setAccuracySearch(event.target.value)}
                  placeholder={copy.accuracySearchPlaceholder}
                  aria-label={copy.accuracySearch}
                  className="min-h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-700 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                />
              </span>
            </label>
            <p className="text-[11px] text-slate-500">{copy.showingVehicles} {accuracyRecords.length} {copy.ofVehicles} {summary.total} · {copy.lastSync}: {formatForthTrackingTime(data.fetchedAt, language) ?? copy.unknownValue}</p>
            {accuracyRecords.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">{copy.accuracyNoMatches}</p>
            ) : (
              <div className="space-y-2">
                {accuracyRecords.map((record) => {
                  const comparisons = getForthAccuracyComparisons(record, data.fetchedAt);
                  const warnings = getForthNormalizationWarnings(record);
                  const key = recordKeysByReference.get(record) ?? getForthFleetRecordKey(record, 0);
                  return (
                    <details key={key} className="rounded-xl border border-slate-200 bg-slate-50/60">
                      <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-3 py-3 text-sm font-semibold text-slate-800">
                        <span>{record.vehicleRegistration || copy.unknownValue} <span className="font-normal text-slate-500">· {record.gpsDeviceId || copy.unknownValue}</span></span>
                        <ActivityPill activity={getForthReportedActivity(record)} copy={copy} />
                      </summary>
                      <div className="grid gap-2 border-t border-slate-200 p-3 sm:grid-cols-2 xl:grid-cols-3">
                        {comparisons.map((comparison) => (
                          <div key={comparison.field} className="min-w-0 rounded-lg border border-slate-200 bg-white p-2.5">
                            <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-600">{accuracyFieldLabel(comparison.field, copy)}</h3>
                            <div className="mt-2 grid grid-cols-2 gap-2">
                              <div className="min-w-0">
                                <p className="text-[10px] font-semibold text-slate-500">{copy.accuracySourceColumn}</p>
                                <p className="mb-1 break-all font-mono text-[10px] text-slate-400">
                                  {comparison.field === "activity_status" ? copy.accuracyActivityNotMapped : comparison.sourceField}
                                </p>
                                <div className="break-words text-xs text-slate-700">
                                  {comparison.source
                                    ? sourceAuditValue(comparison.source, copy)
                                    : comparison.field === "activity_status" ? copy.accuracyActivityNotMapped : copy.accuracyNotApplicable}
                                </div>
                              </div>
                              <div className="min-w-0 border-l border-slate-100 pl-2">
                                <p className="text-[10px] font-semibold text-slate-500">{copy.accuracyNormalizedColumn}</p>
                                <p className="mt-2 break-words text-xs font-medium text-slate-800">
                                  {normalizedAccuracyValue(comparison.field, comparison.normalized, record, data.fetchedAt, copy, language)}
                                </p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="border-t border-slate-200 px-3 py-2.5 text-xs leading-5">
                        <strong className="text-slate-700">{copy.accuracyWarnings}: </strong>
                        {warnings.length
                          ? <span className="text-amber-900">{warnings.map((warning) => accuracyWarningLabel(warning, copy)).join(" · ")}</span>
                          : <span className="text-emerald-800">{copy.accuracyNoWarnings}</span>}
                      </div>
                    </details>
                  );
                })}
              </div>
            )}
          </section>
        </details>
        <details className="rounded-2xl border border-slate-200 bg-white px-4 py-3 sm:px-5">
        <summary className="cursor-pointer text-sm font-semibold text-slate-700">{copy.diagnosticAdvancedTitle}</summary>
        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5" aria-label={copy.diagnosticTitle}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-bold text-slate-900">{copy.diagnosticTitle}</h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">{copy.diagnosticIntro}</p>
            </div>
            <button
              ref={statusDiagnosticTriggerRef}
              type="button"
              className="btn-secondary shrink-0 justify-center gap-2"
              onClick={openStatusDiagnosticConfirmation}
              disabled={!diagnosticCanStart || statusDiagnosticConfirmationOpen}
            >
              <Activity className={"h-4 w-4 " + (statusDiagnosticState === "running" ? "animate-pulse" : "")} />
              {diagnosticButtonLabel}
            </button>
          </div>
          <p
            ref={statusDiagnosticMessageRef}
            tabIndex={-1}
            role={statusDiagnosticState === "failed" ? "alert" : "status"}
            aria-live={statusDiagnosticState === "failed" ? "assertive" : "polite"}
            className={"mt-3 rounded-xl border px-3 py-2 text-xs leading-5 " + diagnosticStateClass}
          >
            <strong>{diagnosticStateLabels[statusDiagnosticState]}:</strong> {diagnosticStatusBody}
          </p>
          {statusDiagnosticState === "completed" && statusDiagnostic?.error ? (
            <p className="mt-2 text-xs leading-5 text-amber-800" role="status">
              {copy.diagnosticEndpointError} {statusDiagnostic.error}
            </p>
          ) : null}
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
              <p><strong>{copy.diagnosticSourceShape}:</strong> {Object.entries(statusDiagnostic.positionSourceShape.canonicalField).map(([key, count]) => `${key.replaceAll("_", " ")} ${count}`).join(" · ")}</p>
              <p><strong>{copy.diagnosticAlternateSources}:</strong> {statusDiagnostic.positionSourceShape.alternateCandidateRecords} records; {Object.entries(statusDiagnostic.positionSourceShape.alternateCandidateValues).map(([key, count]) => `${key.replaceAll("_", " ")} ${count}`).join(" · ")}</p>
              <div className="sm:col-span-2 lg:col-span-3">
                <p><strong>{copy.diagnosticUnknownSourceLabels}:</strong> {statusDiagnostic.unknownPositionSourceStrings.unknownStringCount} unknown string occurrences; {statusDiagnostic.unknownPositionSourceStrings.returnedUniqueCount} unique labels returned; {statusDiagnostic.unknownPositionSourceStrings.notListedOccurrences} occurrences omitted by the list limit; {statusDiagnostic.unknownPositionSourceStrings.rejectedOccurrences} values filtered by safety limits.</p>
                <p className="text-[11px] text-slate-500">{copy.diagnosticUnknownSourceNote}</p>
                {statusDiagnostic.unknownPositionSourceStrings.labels.length ? (
                  <ul className="mt-1 list-disc space-y-0.5 pl-5">
                    {statusDiagnostic.unknownPositionSourceStrings.labels.map((entry, index) => (
                      <li key={index}><code className="break-all font-mono text-[11px]">{entry.label}</code> · {entry.occurrences}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <p className="sm:col-span-2 lg:col-span-3"><strong>{copy.diagnosticClassification}:</strong> {Object.entries(statusDiagnostic.classificationReason).filter(([, count]) => count > 0).map(([key, count]) => `${key.replaceAll("_", " ")} ${count}`).join(" · ") || "—"}</p>
            </div>
          ) : null}
          {statusDiagnosticConfirmationOpen ? (
            <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/45 p-4">
              <div
                ref={statusDiagnosticDialogRef}
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="forth-status-diagnostic-dialog-title"
                aria-describedby="forth-status-diagnostic-dialog-description"
                className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl"
              >
                <h3 id="forth-status-diagnostic-dialog-title" className="text-base font-bold text-slate-950">
                  {copy.diagnosticDialogTitle}
                </h3>
                <p id="forth-status-diagnostic-dialog-description" className="mt-2 text-sm leading-6 text-slate-600">
                  {copy.diagnosticDialogBody}
                </p>
                <div className="mt-5 flex flex-wrap justify-end gap-2">
                  <button
                    ref={statusDiagnosticCancelRef}
                    type="button"
                    className="btn-secondary justify-center"
                    onClick={cancelStatusDiagnosticConfirmation}
                  >
                    {copy.diagnosticDialogCancel}
                  </button>
                  <button
                    type="button"
                    className="btn-primary justify-center"
                    onClick={() => void runStatusDiagnostic()}
                    disabled={statusDiagnosticConfirmStartedRef.current}
                  >
                    {copy.diagnosticDialogRun}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </section>
        </details>
            </div>
          </aside>
        </div>
      ) : null}

    </main>
  );
}
