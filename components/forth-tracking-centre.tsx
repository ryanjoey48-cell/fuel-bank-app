"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { FleetDailyReport } from "@/components/fleet-daily-report";
import { FleetDayReview } from "@/components/fleet-day-review";
import { FleetRecurringAreas } from "@/components/fleet-recurring-areas";
import { FleetEvidencePanel, type EvidenceScope } from "@/components/fleet-evidence-panel";
import { parseScopeParams, withScopeParams } from "@/lib/fleet-scope-url";
import { LIVE_CELLS, LIVE_CELL_COPY, liveStatusMatrix } from "@/lib/fleet-live-matrix";
import { FleetLocationCrossRef } from "@/components/fleet-location-crossref";
import { FleetVehicleBar, type FleetVehicleOption } from "@/components/fleet-workspace-bar";
import { FleetFuelReport } from "@/components/fleet-fuel-report";
import { FleetMileageReport } from "@/components/fleet-mileage-report";
import { describeForthGpsHealth } from "@/lib/forth-gps-health";
import { describeLiveVehicle, gpsSummaryFor, liveStatementLabel } from "@/lib/forth-live-status";
import { AccountMenu } from "@/components/account-menu";
import { LanguageSwitcher } from "@/components/language-switcher";
import {
  Activity,
  CarFront,
  ChevronDown,
  Copy,
  ExternalLink,
  Gauge,
  MapPinned,
  PanelLeft,
  RefreshCw,
  Search,
  SignalZero,
  SlidersHorizontal,
  Truck,
  Wrench,
  Wifi,
  WifiOff,
  X
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { safeLocalStorage, safeSessionStorage } from "@/lib/safe-browser-storage";
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
  getForthAttentionKinds,
  getForthFleetMapInitialFrame,
  getForthFleetMapModeRecords,
  getForthAccuracyComparisons,
  getForthFleetRecordKey,
  getForthLocationDescription,
  getForthLocationArea,
  getForthTrackingVehicleIdentity,
  findForthFleetRecord,
  getForthFleetMapRecords,
  getForthNormalizationWarnings,
  getForthReportedActivity,
  isForthGpsPositionVerified,
  isForthHighReportedSpeed,
  summarizeForthFleet,
  sortForthFleetRecords,
  type ForthFleetFilter,
  type ForthAccuracyField,
  type ForthNormalizationWarning,
  type ForthFleetSort,
  type ForthReportedActivity
} from "@/lib/forth-tracking-view";
import { ForthFleetAlerts } from "@/components/forth-fleet-alerts";
import { ForthSpeedWatch, ForthSpeedWatchLauncher } from "@/components/forth-speed-watch";
import type { ForthFleetTrackingData, ForthFleetTrackingRecord } from "@/lib/forth-tracking-server";
import { matchForthVehicle, type ForthSourceFieldSnapshot } from "@/lib/forth-tracking";
import { attachUniqueActiveDriverAssignments, type LiveEesVehicleIdentity } from "@/lib/fleet-tracking-v2/live-adapter";
import {
  FORTH_MONITOR_DISPLAY_DETAILED,
  FORTH_MONITOR_DISPLAY_OPERATIONS,
  readForthMonitorDisplay,
  resolveForthMonitorDisplayPreset,
  writeForthMonitorDisplay,
  type ForthMonitorDisplayField
} from "@/lib/forth-monitor-display";
import {
  classifyOutsideCoreOperations,
  forthReportedCoordinateClipboardText,
  forthReportedCoordinateMapsUrl,
  type ForthMapCameraMode
} from "@/lib/forth-map-ops";
import {
  classifyDrivingOutsideCoreOperations,
  classifyDrivingOutsideViewport,
  filterForthMapDisplayRecords,
  getForthDrivingMapRecords,
  resolveForthMapViewLabel,
  type ForthMapDisplayFilter
} from "@/lib/forth-visual-fleet";
import { findNearbyLocationsForVehicle, joinMappedDirectoryLocations, type FleetDirectoryLocation } from "@/lib/forth-fleet-locations";
import {
  isEesDepotOrOfficeCategory,
  selectForthMapPaintLocations,
  type ForthGpsMapLocation
} from "@/lib/forth-gps-map-locations";
import { ForthGpsLocationsPanel } from "@/components/forth-gps-locations-panel";
import {
  ForthJourneyPlaybackPanel,
  type ForthJourneyPlaybackPanelHandle
} from "@/components/forth-journey-playback-panel";
import { ForthSpeedConfigPanel } from "@/components/forth-speed-config-panel";
import {
  createInactivePlaybackOverlay,
  resolveExitPlaybackTarget,
  resolvePlaybackReturnMode,
  type ForthLiveWorkspaceMode,
  type ForthPlaybackOverlayState,
  type ForthWorkspaceMode
} from "@/lib/forth-playback-mode";
import { ageForthSnapshot, retainForthSnapshot, FORTH_FLEET_REQUEST_TIMEOUT_MS } from "@/lib/forth-operations-snapshot";
import "@/components/forth-operations-v21.css";
import "@/components/fleet-premium-v3.css";
import "@/components/fleet-tracking-v7.css";
import "@/components/fleet-tracking-v71.css";
import "@/components/fleet-tracking-v72.css";
import "@/components/fleet-tracking-v73.css";
import { EesDepotOperationsPanel } from "@/components/ees-depot-operations-panel";
import { FORTH_GPS_SOURCE_LABEL } from "@/lib/forth-selected-locations";
import {
  evaluateForthSpeedReview,
  forthSpeedEvidenceLabel,
  forthSpeedReviewConfidenceLabel
} from "@/lib/forth-speed-review";

const ForthTrackingMap = dynamic(
  () => import("@/components/forth-tracking-map").then((module) => module.ForthTrackingMap),
  { ssr: false, loading: () => <div className="min-h-0 flex-1 animate-pulse rounded-2xl bg-slate-100" /> }
);

// Free-plan friendly: poll less often; identities refresh on a slower cadence than GPS.
const POLL_INTERVAL_MS = 180_000;
const FLEET_IDENTITY_TTL_MS = 300_000;
const VISIBLE_RELOAD_MIN_GAP_MS = 30_000;
const REQUEST_TIMEOUT_MS = FORTH_FLEET_REQUEST_TIMEOUT_MS;
const EMPTY_MAP_RECORDS: ForthFleetTrackingRecord[] = [];
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

type MapViewCommand = {
  type: "fit" | "fit_all" | "bangkok" | "thailand_neighbours" | "focus" | "focus_location" | "fit_locations";
  sequence: number;
  key?: string | null;
  zoom?: number;
  location?: { latitude: number; longitude: number } | null;
  locations?: Array<{ latitude: number; longitude: number }>;
};

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
    movingHelper: "Fresh positive speed with no Engine OFF conflict",
    activityConflictNote: "Forth reports positive speed while Engine is OFF; movement is not confirmed.",
    activityConflictCount: "Readings conflict",
    activityConflictHelper: "Fresh positive speed and Engine OFF",
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
    needsAttentionHelper: "Offline, stale, missing coordinates, conflicting readings, or speed review",
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
    activityUncertain: "Activity uncertain",
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
    motionReasonConflict: "Fresh positive speed conflicts with Forth Engine OFF",
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
    requestTimeoutFailure: "The live tracking request timed out. Saved Forth locations stay available; vehicle markers use the last successful snapshot when one exists.",
    requestUpstreamFailure: "Forth tracking could not be reached. Saved Forth locations stay available; vehicle markers use the last successful snapshot when one exists.",
    requestInvalidResponseFailure: "The tracking service returned an unreadable response. Saved Forth locations stay available; vehicle markers use the last successful snapshot when one exists.",
    staleSnapshotHidden: "Last successful vehicle refresh:",
    mapTitle: "Live vehicle map",
    mapDescription: "Select a marker or vehicle to inspect its latest reported position.",
    noPositions: "No vehicles currently have valid coordinates to plot.",
    mapRegionLabel: "Fleet tracking map",
    mapLoading: "Loading map…",
    mapUnavailable: "The map could not be loaded. The vehicle list is still available.",
    listTitle: "Tracked vehicles",
    listDescription: "Search by registration, place description, reported driver or device ID.",
    search: "Search vehicles",
    filter: "Filter by reported activity",
    all: "All activity",
    drivingFilter: "Reported driving",
    stoppedFilter: "Reported stopped",
    unknown: "Activity unavailable",
    sort: "Sort vehicles",
    sortOperations: "Operations priority",
    sortRegistration: "Registration",
    sortSpeed: "Speed: highest first",
    sortUpdated: "Position time: newest first",
    sortStatus: "Activity state",
    displayPresetOps: "Operations",
    displayPresetDetailed: "Detailed",
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
    mapConfidence: "Dashed amber ring = position not GPS-verified",
    groupVehicles: "vehicles",
    expandGroup: "Select to separate all vehicles",
    mapLegendHelp: "Legend",
    mapGroupHelp: "Vehicles sharing a reported location use one pin on that position. Choose a registration from the short list.",
    mapConflictLegend: "Orange-brown marker means positive Speed conflicts with Engine OFF.",
    mapOfflineLegend: "Red corner dot means GPRS is reported offline",
    mapSelectedLegend: "Purple ring marks the selected vehicle",
    mapEngineOnStop: "Amber = stopped, engine on",
    mapEngineOffStop: "Indigo = stopped, engine off",
    mapEngineUnknownStop: "Grey = engine state unknown",
    mapLabelHint: "Vehicle labels declutter as markers overlap; select a vehicle to prioritize its label",
    freshnessShort: "Freshness window: 15 min",
    lastVehicleUpdate: "Last vehicle update",
    latestPosition: "Latest position",
    noPlaceDescription: "No place description reported",
    reportedPositionOnMap: "Reported position shown on map",
    technicalDetails: "Technical details",
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
    noGpsSourceNote: "Forth labelled this reading “No GPS”. Coordinates may still be present; this is not automatic proof that the tracker is offline or broken.",
    noGpsLegend: "“No GPS” = Forth position-source label, separate from tracker connectivity and report age.",
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
    filterUncertain: "Activity uncertain",
    activityGroup: "Activity",
    attentionGroup: "Fleet signals",
    listCount: "vehicles",
    driverUnavailable: "Driver unavailable",
    onlineLabel: "Online",
    engineOnLabel: "Engine on",
    engineOffLabel: "Engine off",
    currentGpsCount: "Current GPS positions",
    locationSection: "Reported location",
    connectionTimingSection: "Tracker and timing",
    sourceSection: "Position source",
    reportedCoordinates: "Reported coordinates",
    approximateCoordinatesNote: "Position source is not GPS-verified; coordinates may be approximate.",
    focusOnMap: "Focus on map",
    activityBasis: "Fresh Speed and Engine fields; not a Forth Working/Parking state",
    monitorTitle: "Fleet Monitor",
    monitorToggle: "Fleet Monitor",
    fleetOverview: "Fleet overview",
    clearSearch: "Clear",
    forthDriverUnverified: "Forth-reported driver · unverified",
    confirmedDriverLabel: "Assigned driver",
    locationUnavailable: "Location unavailable",
    lastReportedStat: "Last reported",
    gpsVerifiedStat: "GPS verified",
    attentionMissing: "Missing coordinates",
    sharedHere: "Vehicles at this position",
    sharedHint: "One reported location. Choose a registration.",
    mapOverlapTitle: "Vehicles overlapping at this map scale",
    mapOverlapHint: "Each vehicle keeps its reported position. Choose a registration to inspect it.",
    sharedSearch: "Search these registrations",
    mapViews: "More",
    staleReport: "Stale report",
    trackerOfflineShort: "Tracker offline",
    unverifiedNote: "Last reported or unverified. This is not a fault by itself.",
    engineStopNote: "Stopped with engine on. Duration is not reported.",
    filterVerified: "GPS verified",
    clearFilters: "Clear filters",
    opsStrip: "Fleet status",
    trackerStatus: "Tracker",
    reportAge: "Report age",
    vehicleType: "Vehicle type",
    activityConflictShort: "Speed/engine conflict",
    speedReview: "Speed review",
    speedReviewNote: "GPS-verified Forth speed compared to owner-reported device alert settings. Delay is not proven by a single snapshot. Road legal limits are unavailable.",
    speedLimitUnavailable: "Road limit unavailable",
    speedAdvisoryLabel: "Device alert",
    speedOverAdvisory: "vs alert",
    speedReviewConfidence: "Review confidence",
    speedDelayLabel: "Alert delay",
    speedEvidenceLabel: "Evidence",
    speedSettings: "Speed settings",
    mapVerifiedMode: "Current GPS positions",
    mapHiddenCount: "other positions remain in Fleet Monitor",
    mapTrustNote: "All reported shows every valid Forth coordinate. Solid markers have a current GPS fix; dashed markers are approximate or unverified. GPS only hides approximate positions. Coordinates are shown exactly as reported.",
    mapNotPlotted: "Approximate Forth position. Confirm the location before dispatch.",
    mapInView: "GPS positions in view",
    mapUnverifiedInMonitor: "positions are approximate",
    mapFitAllGps: "View outside area",
    showDrivingOnMap: "Show driving on map",
    showAllDriving: "Show all driving",
    drivingOutsideArea: "driving vehicles outside this area",
    mapShowingCore: "Showing: Core Operations",
    mapShowingFleet: "Showing: All Fleet",
    mapShowingDriving: "Showing: Driving vehicles",
    mapShowingGps: "Showing: GPS-verified",
    mapShowingSelected: "Showing: Selected vehicle",
    returnCoreOps: "Return to Core Operations",
    mapNotMappedShort: "Estimated position"
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
    movingHelper: "ความเร็วเป็นบวกและไม่มีรายงานว่าเครื่องยนต์ปิด",
    activityConflictNote: "Forth รายงานความเร็วมากกว่าศูนย์แต่ Engine เป็นปิด จึงยังยืนยันการเคลื่อนที่ไม่ได้",
    activityConflictCount: "ข้อมูลขัดแย้ง",
    activityConflictHelper: "ความเร็วใหม่เป็นบวกและ Engine ปิด",
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
    needsAttentionHelper: "ออฟไลน์ รายงานเก่า ไม่มีพิกัด ค่าขัดแย้ง หรือตรวจสอบความเร็ว",
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
    activityUncertain: "กิจกรรมไม่แน่ชัด",
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
    motionReasonConflict: "ความเร็วใหม่เป็นบวกแต่ Forth รายงาน Engine ปิด",
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
    requestTimeoutFailure: "คำขอติดตามสดหมดเวลา สถานที่ Forth ยังใช้ได้ และจะแสดงตำแหน่งรถจากชุดข้อมูลล่าสุดที่สำเร็จถ้ามี",
    requestUpstreamFailure: "ไม่สามารถเชื่อมต่อ Forth Tracking ได้ สถานที่ Forth ยังใช้ได้ และจะแสดงตำแหน่งรถจากชุดข้อมูลล่าสุดที่สำเร็จถ้ามี",
    requestInvalidResponseFailure: "บริการติดตามส่งข้อมูลที่อ่านไม่ได้ สถานที่ Forth ยังใช้ได้ และจะแสดงตำแหน่งรถจากชุดข้อมูลล่าสุดที่สำเร็จถ้ามี",
    staleSnapshotHidden: "รีเฟรชรถครั้งล่าสุดที่สำเร็จ:",
    mapTitle: "แผนที่รถแบบเรียลไทม์",
    mapDescription: "เลือกหมุดหรือรถเพื่อดูตำแหน่งล่าสุดที่รายงาน",
    noPositions: "ขณะนี้ไม่มีรถที่มีพิกัดถูกต้องบนแผนที่",
    mapRegionLabel: "แผนที่ติดตามยานพาหนะ",
    mapLoading: "กำลังโหลดแผนที่…",
    mapUnavailable: "โหลดแผนที่ไม่ได้ แต่ยังดูรายการรถได้",
    listTitle: "จอภาพกองรถ",
    listDescription: "ค้นหาด้วยทะเบียน สถานที่ ผู้ขับที่รายงาน หรือรหัสอุปกรณ์",
    search: "ค้นหารถ",
    filter: "กรองตามกิจกรรมที่รายงาน",
    all: "ทุกกิจกรรม",
    drivingFilter: "รายงานว่ากำลังขับ",
    stoppedFilter: "รายงานว่าหยุด",
    unknown: "ไม่มีกิจกรรมที่ยืนยันได้",
    sort: "เรียงรถ",
    sortOperations: "ลำดับงานปฏิบัติการ",
    sortRegistration: "ทะเบียนรถ",
    sortSpeed: "ความเร็ว: มากไปน้อย",
    sortUpdated: "เวลาตำแหน่ง: ใหม่ไปเก่า",
    sortStatus: "สถานะการเคลื่อนที่",
    displayPresetOps: "ปฏิบัติการ",
    displayPresetDetailed: "ละเอียด",
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
    mapConfidence: "วงประสีเหลืองหมายถึงตำแหน่งที่ยังไม่ยืนยันด้วย GPS",
    groupVehicles: "คัน",
    expandGroup: "เลือกเพื่อแยกหมุดรถทั้งหมด",
    mapLegendHelp: "คำอธิบาย",
    mapGroupHelp: "รถที่รายงานตำแหน่งเดียวกันใช้หมุดเดียวที่จุดนั้น เลือกทะเบียนจากรายการสั้น",
    mapConflictLegend: "หมุดสีน้ำตาลส้มหมายถึงความเร็วเป็นบวกแต่ Engine รายงานว่าปิด",
    mapOfflineLegend: "จุดสีแดงที่มุมหมายถึงรายงานว่า GPRS ออฟไลน์",
    mapSelectedLegend: "วงสีม่วงแสดงรถที่เลือก",
    mapEngineOnStop: "สีเหลืองอำพัน = หยุด เครื่องยนต์เปิด",
    mapEngineOffStop: "สีคราม = หยุด เครื่องยนต์ปิด",
    mapEngineUnknownStop: "สีเทา = ไม่ทราบสถานะเครื่องยนต์",
    mapLabelHint: "ซ่อนป้ายทะเบียนเมื่อหมุดทับกัน; เลือกรถเพื่อจัดลำดับป้ายทะเบียนก่อน",
    freshnessShort: "ช่วงข้อมูลปัจจุบัน: 15 นาที",
    lastVehicleUpdate: "อัปเดตรถล่าสุด",
    latestPosition: "ตำแหน่งล่าสุด",
    noPlaceDescription: "ไม่มีรายงานชื่อสถานที่",
    reportedPositionOnMap: "ตำแหน่งที่รายงานแสดงบนแผนที่",
    technicalDetails: "รายละเอียดทางเทคนิค",
    exactPositionTime: "เวลาประเทศไทย",
    openDetails: "เปิดรายละเอียด",
    mapFitFleet: "แสดงกองรถทั้งหมด",
    mapHideInspector: "ซ่อนรายละเอียด",
    mapShowInspector: "แสดงรายละเอียด",
    mapBrowseVehicles: "เลือกรถ",
    mapCloseInspector: "ปิดรายละเอียด",
    attention: "รายการที่ควรตรวจสอบ",
    activeFilter: "กำลังแสดง",
    resetFilter: "ล้างตัวกรอง",
    noGpsSourceNote: "Forth ระบุแหล่งตำแหน่งว่า “No GPS” อาจยังมีพิกัดอยู่ และไม่ได้พิสูจน์โดยอัตโนมัติว่าตัวติดตามออฟไลน์หรือเสีย",
    noGpsLegend: "“No GPS” = ป้ายแหล่งตำแหน่งจาก Forth แยกจากการเชื่อมต่อตัวติดตามและอายุรายงาน",
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
    filterUncertain: "กิจกรรมไม่แน่ชัด",
    activityGroup: "กิจกรรม",
    attentionGroup: "สัญญาณกองรถ",
    listCount: "คัน",
    driverUnavailable: "ไม่มีข้อมูลผู้ขับ",
    onlineLabel: "ออนไลน์",
    engineOnLabel: "เครื่องยนต์เปิด",
    engineOffLabel: "เครื่องยนต์ปิด",
    currentGpsCount: "ตำแหน่ง GPS ปัจจุบัน",
    locationSection: "ตำแหน่งที่รายงาน",
    connectionTimingSection: "ตัวติดตามและเวลา",
    sourceSection: "แหล่งตำแหน่ง",
    reportedCoordinates: "พิกัดที่รายงาน",
    approximateCoordinatesNote: "แหล่งตำแหน่งยังไม่ยืนยันด้วย GPS พิกัดอาจเป็นค่าโดยประมาณ",
    focusOnMap: "โฟกัสบนแผนที่",
    activityBasis: "ฟิลด์ Speed และ Engine ที่ยังใหม่ ไม่ใช่สถานะ Working/Parking จาก Forth",
    monitorTitle: "จอภาพกองรถ",
    monitorToggle: "จอภาพกองรถ",
    fleetOverview: "ภาพรวมกองรถ",
    clearSearch: "ล้าง",
    forthDriverUnverified: "ผู้ขับจาก Forth · ยังไม่ยืนยัน",
    confirmedDriverLabel: "คนขับที่มอบหมาย",
    locationUnavailable: "ไม่มีตำแหน่ง",
    lastReportedStat: "ตำแหน่งรายงานล่าสุด",
    gpsVerifiedStat: "ยืนยัน GPS",
    attentionMissing: "ไม่มีพิกัด",
    sharedHere: "รถที่ตำแหน่งนี้",
    sharedHint: "ตำแหน่งรายงานเดียวกัน เลือกทะเบียน",
    mapOverlapTitle: "รถที่สัญลักษณ์ทับกันในมุมมองนี้",
    mapOverlapHint: "รถแต่ละคันคงพิกัดที่รายงานไว้ เลือกทะเบียนเพื่อดูรายละเอียด",
    sharedSearch: "ค้นหาทะเบียนในรายการนี้",
    mapViews: "เพิ่มเติม",
    staleReport: "รายงานเก่า",
    trackerOfflineShort: "ตัวติดตามออฟไลน์",
    unverifiedNote: "ตำแหน่งรายงานล่าสุดหรือยังไม่ยืนยัน ไม่ได้หมายความว่าเป็นความผิดปกติ",
    engineStopNote: "หยุดและเครื่องยนต์เปิด ไม่มีรายงานระยะเวลา",
    filterVerified: "ยืนยัน GPS",
    clearFilters: "ล้างตัวกรอง",
    opsStrip: "สถานะกองรถ",
    trackerStatus: "ตัวติดตาม",
    reportAge: "อายุรายงาน",
    vehicleType: "ประเภทรถ",
    activityConflictShort: "ความเร็ว/เครื่องยนต์ขัดแย้ง",
    speedReview: "ตรวจสอบความเร็ว",
    speedReviewNote: "เปรียบเทียบความเร็ว Forth ที่ยืนยัน GPS กับเกณฑ์แจ้งเตือนอุปกรณ์ที่เจ้าของรายงาน หน่วงเวลาไม่ได้พิสูจน์จากสแนปช็อตเดียว ไม่มีขีดจำกัดถนน",
    speedLimitUnavailable: "ไม่มีขีดจำกัดถนน",
    speedAdvisoryLabel: "เกณฑ์อุปกรณ์",
    speedOverAdvisory: "เทียบเกณฑ์",
    speedReviewConfidence: "ความมั่นใจการตรวจสอบ",
    speedDelayLabel: "หน่วงการแจ้งเตือน",
    speedEvidenceLabel: "หลักฐาน",
    speedSettings: "การตั้งค่าความเร็ว",
    mapVerifiedMode: "ตำแหน่ง GPS ปัจจุบัน",
    mapHiddenCount: "ตำแหน่งอื่นยังอยู่ในจอภาพกองรถ",
    mapTrustNote: "รายงานทั้งหมดแสดงพิกัดที่ใช้ได้ทุกจุดจาก Forth หมุดทึบคือ GPS ปัจจุบัน หมุดเส้นประคือตำแหน่งโดยประมาณหรือยังไม่ยืนยัน พิกัดแสดงตามรายงานเดิม",
    mapNotPlotted: "ตำแหน่ง Forth โดยประมาณ โปรดยืนยันตำแหน่งก่อนสั่งงาน",
    mapInView: "ตำแหน่ง GPS ในมุมมอง",
    mapUnverifiedInMonitor: "ตำแหน่งโดยประมาณ",
    mapFitAllGps: "ดูรถนอกพื้นที่",
    showDrivingOnMap: "แสดงรถที่กำลังขับบนแผนที่",
    showAllDriving: "แสดงรถที่กำลังขับทั้งหมด",
    drivingOutsideArea: "คันที่กำลังขับอยู่นอกพื้นที่นี้",
    mapShowingCore: "กำลังแสดง: ปฏิบัติการหลัก",
    mapShowingFleet: "กำลังแสดง: ทั้งกอง",
    mapShowingDriving: "กำลังแสดง: รถที่กำลังขับ",
    mapShowingGps: "กำลังแสดง: GPS ยืนยัน",
    mapShowingSelected: "กำลังแสดง: รถที่เลือก",
    returnCoreOps: "กลับไปปฏิบัติการหลัก",
    mapNotMappedShort: "ตำแหน่งประมาณการ"
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
      const record = entry as Record<string, unknown>;
      const validLocationText = (field: string) => record[field] === null ||
        (typeof record[field] === "string" && Array.from(record[field] as string).length <= 240);
      return SOURCE_AUDIT_FIELDS.every((field) => isSourceFieldSnapshot(source[field])) &&
        validLocationText("locationAddressEnglish") &&
        validLocationText("locationAddressThai") &&
        validLocationText("locationPointOfInterest");
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
  if (activity === "uncertain") return copy.activityUncertain;
  if (activity === "stopped_engine_on") return copy.activityStoppedEngineOn;
  if (activity === "stopped_engine_off") return copy.activityStoppedEngineOff;
  if (activity === "stopped_engine_unknown") return copy.activityStoppedEngineUnknown;
  return copy.activityUnavailable;
}

/** Compact monitor/group wording — engine detail stays in the inspector. */
function activityTextCompact(activity: ForthReportedActivity, copy: Copy) {
  if (activity === "driving") return copy.activityDriving;
  if (activity === "uncertain") return copy.activityUncertain;
  if (activity === "unavailable") return copy.activityUnavailable;
  return copy.parked;
}

function activityStyle(activity: ForthReportedActivity) {
  if (activity === "driving") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (activity === "uncertain") return "border-orange-200 bg-orange-50 text-orange-900";
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

function ActivityPill({ activity, copy, compact = false }: { activity: ForthReportedActivity; copy: Copy; compact?: boolean }) {
  return (
    <span className={"forth-activity-label inline-flex min-h-0 items-center px-0 py-0 text-[12px] font-semibold leading-none " + activityStyle(activity)}>
      {compact ? activityTextCompact(activity, copy) : activityText(activity, copy)}
    </span>
  );
}

function vehicleCategoryLabel(vehicleClass: ReturnType<typeof getForthTrackingVehicleIdentity>["vehicleClass"], language: "en" | "th") {
  if (language === "th") {
    if (vehicleClass === "four_wheeler") return "รถ 4 ล้อ";
    if (vehicleClass === "six_wheeler") return "รถ 6 ล้อ";
    if (vehicleClass === "six_plus_six_wheeler") return "รถ 6+6 ล้อ";
    if (vehicleClass === "eighteen_wheeler") return "รถพ่วง 18 ล้อ";
    return "";
  }
  if (vehicleClass === "four_wheeler") return "4-wheeler";
  if (vehicleClass === "six_wheeler") return "6-wheeler";
  if (vehicleClass === "six_plus_six_wheeler") return "6+6-wheeler";
  if (vehicleClass === "eighteen_wheeler") return "18-wheeler";
  return "";
}

function matchedEesVehicle(record: ForthFleetTrackingRecord, vehicles: LiveEesVehicleIdentity[] | null) {
  if (!vehicles?.length) return null;
  const match = matchForthVehicle({
    gpsDeviceId: record.gpsDeviceId,
    vehicleRegistration: record.vehicleRegistration
  }, vehicles);
  if (match.status !== "matched" || !match.vehicleId) return null;
  return vehicles.find((item) => item.id === match.vehicleId) ?? null;
}

function confirmedAssignedDriver(record: ForthFleetTrackingRecord, vehicles: LiveEesVehicleIdentity[] | null) {
  const vehicle = matchedEesVehicle(record, vehicles);
  return vehicle?.driverAssignmentStatus === "confirmed" ? vehicle.assignedDriverName ?? null : null;
}

let eesFleetIdentityCache: { expiresAt: number; value: LiveEesVehicleIdentity[] | null; promise?: Promise<LiveEesVehicleIdentity[] | null> } | null = null;

async function loadEesFleetIdentities(force = false) {
  const now = Date.now();
  if (!force && eesFleetIdentityCache?.value && eesFleetIdentityCache.expiresAt > now) {
    return eesFleetIdentityCache.value;
  }
  if (!force && eesFleetIdentityCache?.promise) {
    return eesFleetIdentityCache.promise;
  }

  const promise = (async () => {
    try {
      const [vehicleResult, driverResult] = await Promise.all([
        supabase.from("vehicles").select("id,vehicle_reg,vehicle_name,vehicle_type,vehicle_category").order("vehicle_reg", { ascending: true }),
        supabase.from("drivers").select("id,name,active,assigned_vehicle_id").order("name", { ascending: true })
      ]);
      if (vehicleResult.error || !Array.isArray(vehicleResult.data)) return null;
      const driverRows = driverResult.error || !Array.isArray(driverResult.data) ? null : driverResult.data;
      return attachUniqueActiveDriverAssignments(vehicleResult.data as LiveEesVehicleIdentity[], driverRows);
    } catch {
      return null;
    }
  })();

  eesFleetIdentityCache = { expiresAt: now + FLEET_IDENTITY_TTL_MS, value: eesFleetIdentityCache?.value ?? null, promise };
  const value = await promise;
  eesFleetIdentityCache = { expiresAt: Date.now() + FLEET_IDENTITY_TTL_MS, value };
  return value;
}

const FleetVehicleRow = memo(function FleetVehicleRow({
  record,
  recordKey,
  active,
  copy,
  language,
  confirmedDriver,
  display,
  rowRef,
  onSelect
}: {
  record: ForthFleetTrackingRecord;
  recordKey: string;
  active: boolean;
  copy: Copy;
  language: "en" | "th";
  confirmedDriver: string | null;
  display: Record<ForthMonitorDisplayField, boolean>;
  rowRef?: (node: HTMLButtonElement | null) => void;
  onSelect: (key: string) => void;
}) {
  const activity = getForthReportedActivity(record);
  const identity = getForthTrackingVehicleIdentity(record.vehicleRegistration);
  const category = vehicleCategoryLabel(identity.vehicleClass, language);
  const vehicleProfile = [category, identity.make, identity.model].filter(Boolean).join(" · ");
  const updateTime = formatForthRelativeAge(record.lastGpsTimestamp, Date.now(), language);
  const exactUpdateTime = formatForthTrackingTime(record.lastGpsTimestamp, language);
  const accessibleUpdateTime = updateTime
    ? `${updateTime}${exactUpdateTime ? `. ${copy.exactPositionTime}: ${exactUpdateTime}` : ""}`
    : copy.unknownValue;
  const locationDescription = getForthLocationDescription(record, language);
  const hasCoordinates = record.coordinateStatus === "valid";
  const positionText = !hasCoordinates
    ? copy.locationUnavailable
    : isForthGpsPositionVerified(record) ? copy.gpsPositionVerified : copy.mapNotMappedShort;
  const attention = getForthAttentionKinds(record);
  const hasActionSignal = attention.includes("offline") || attention.includes("stale") || attention.includes("speed_engine_conflict");
  const hasCriticalSignal = attention.includes("offline") || attention.includes("stale");
  const forthDriver = record.reportedDriver && record.reportedDriver !== confirmedDriver ? record.reportedDriver : null;
  const driverLine = confirmedDriver
    ? `${copy.confirmedDriverLabel} · ${confirmedDriver}`
    : forthDriver
      ? `${copy.forthDriverUnverified}: ${forthDriver}`
      : null;

  const gpsLabel = isForthGpsPositionVerified(record)
    ? (language === "th" ? "GPS ยืนยัน" : "GPS verified")
    : (language === "th" ? "GPS ไม่ยืนยัน" : "GPS unverified");

  return (
    <button ref={rowRef} type="button" aria-pressed={active} data-activity={activity} data-gps={isForthGpsPositionVerified(record) ? "verified" : "unverified"} data-attention={hasActionSignal ? "true" : undefined} data-critical={hasCriticalSignal ? "true" : undefined} onClick={() => onSelect(recordKey)} className={`forth-vehicle-row${active ? " is-selected" : ""}`}>
      <span className="forth-row-main">
        <span className="forth-row-vehicle-symbol" data-class={identity.vehicleClass} title={vehicleProfile || undefined}>
          {identity.vehicleClass === "four_wheeler" ? <CarFront aria-hidden="true" /> : <Truck aria-hidden="true" />}
          <span className="sr-only">{vehicleProfile}</span>
        </span>
        <span className="forth-row-identity">
          <span className="forth-vehicle-reg" title={[vehicleProfile, driverLine].filter(Boolean).join(" · ")}>{record.vehicleRegistration || copy.unknownValue}</span>
        </span>
        <span className={`forth-row-speed${activity === "driving" ? " is-driving" : ""}${isForthHighReportedSpeed(record) ? " is-high" : ""}`}>
          <strong>{record.speed === null ? "—" : record.speed}</strong><small>km/h</small>
        </span>
        <ActivityPill activity={activity} copy={copy} compact />
        <span className={`forth-row-confidence ${isForthGpsPositionVerified(record) ? "is-verified" : hasCoordinates ? "is-reported" : "is-missing"}`} title={`${gpsLabel} · ${positionText}`} aria-label={gpsLabel}>
          <span aria-hidden="true">{isForthGpsPositionVerified(record) ? "✓ GPS" : "? GPS"}</span>
        </span>
        <span className="forth-row-age" title={exactUpdateTime ?? undefined} aria-label={accessibleUpdateTime}>{updateTime ? compactAge(updateTime) : copy.unknownValue}</span>
      </span>
      <span className="forth-row-meta">
        {activity === "driving" && record.speed !== null ? <strong className="forth-row-speed-inline">{record.speed} km/h · </strong> : null}
        <span className="forth-vehicle-location" title={[locationDescription, driverLine].filter(Boolean).join(" · ")}>
          {display.driver && confirmedDriver ? confirmedDriver : getForthLocationArea(record, language) ?? copy.locationUnavailable}
        </span>
      </span>
    </button>
  );
});

/** Row-only shorthand for the relative age ("Updated 44 sec ago" -> "44s"); the full wording stays in the aria-label and tooltip. */
function compactAge(text: string) {
  return text
    .replace(/^(Updated|อัปเดต)\s*/i, "")
    .replace(/^just now$/i, "now")
    .replace(/\s*sec ago$/, "s")
    .replace(/\s*min ago$/, "m")
    .replace(/\s*hr ago$/, "h")
    .replace(/\s*days? ago$/, "d")
    .replace(/\s*ที่แล้ว$/, "");
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
  const [sort, setSort] = useState<ForthFleetSort>("operations");
  const sortLabel = {
    operations: copy.sortOperations,
    registration: copy.sortRegistration,
    speed_desc: copy.sortSpeed,
    updated_desc: copy.sortUpdated,
    status: copy.sortStatus
  }[sort];
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [mobileListOpen, setMobileListOpen] = useState(true);
  const [workspaceMode, setWorkspaceMode] = useState<ForthWorkspaceMode>("overview");
  const [intelligenceSection, setIntelligenceSection] = useState("live");
  const [mapCollapsed, setMapCollapsed] = useState(false);
  // V7: the vehicle filters live behind one compact toggle; search stays always visible.
  const [filtersOpen, setFiltersOpen] = useState(false);
  // V7.1: the route map is opened on demand from Journeys; the shared date scope and the historical vehicle outlive workspace switches.
  const [routeMapOpen, setRouteMapOpen] = useState(false);
  const [evidenceScope, setEvidenceScope] = useState<EvidenceScope | null>(null);
  const [workspaceVehicleId, setWorkspaceVehicleId] = useState<string | null>(null);
  const pendingUrlVehicleRef = useRef<string | null>(null);
  // V7: on phones and tablets the vehicle list is an on-demand sheet, so the map is what the user sees first.
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia?.("(max-width: 1100px)").matches) setMobileListOpen(false);
  }, []);
  const [detailSection, setDetailSection] = useState("overview");
  // V6.1: set only by a drill-down from the fleet daily review; applies to that registration alone.
  const [reviewDrill, setReviewDrill] = useState<{ registration: string; day: string } | null>(null);
  const [vehicleCategory, setVehicleCategory] = useState("all");
  const vehicleDetailsCloseRef = useRef<HTMLButtonElement | null>(null);
  const drawerWasOpenRef = useRef(false);
  const [playbackReturnMode, setPlaybackReturnMode] = useState<ForthLiveWorkspaceMode>("overview");
  const [playbackOverlay, setPlaybackOverlay] = useState<ForthPlaybackOverlayState>(() => createInactivePlaybackOverlay());
  const [playbackCursorOverride, setPlaybackCursorOverride] = useState<number | null>(null);
  const playbackPanelRef = useRef<ForthJourneyPlaybackPanelHandle | null>(null);
  const exitPlaybackRef = useRef<(requestedMode?: ForthWorkspaceMode | null) => void>(() => undefined);
  const [snapshotNow, setSnapshotNow] = useState(() => Date.now());
  const fleetRecords = useMemo(() => ageForthSnapshot(data?.records ?? [], snapshotNow, requestError || data?.connectionStatus !== "connected"), [data, snapshotNow, requestError]);
  useEffect(() => {
    const timer = window.setInterval(() => setSnapshotNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const [eesVehicles, setEesVehicles] = useState<LiveEesVehicleIdentity[] | null>(null);
  const [sharedLocationQuery, setSharedLocationQuery] = useState("");
  const [sharedLocationKeys, setSharedLocationKeys] = useState<string[] | null>(null);
  const [sharedLocationKind, setSharedLocationKind] = useState<"reported_position" | "map_overlap">("reported_position");
  const [moreOpen, setMoreOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false);
  const [mapCommand, setMapCommand] = useState<MapViewCommand>({ type: "bangkok", sequence: 0 });
  const [visibleMapKeys, setVisibleMapKeys] = useState<string[] | null>(null);
  const publishVisibleMapKeys = useCallback((keys: string[]) => {
    setVisibleMapKeys(current => current?.length === keys.length && current.every((key, index) => key === keys[index]) ? current : keys);
  }, []);
  const [markerCoverage, setMarkerCoverage] = useState<{ vehicleKeys: string[]; symbolCount: number; readableRegistrationCount: number; screenOverlapCount: number; sharedPositionCount: number } | null>(null);
  const [mapCoverageOpen, setMapCoverageOpen] = useState(false);
  const [offscreenOpen, setOffscreenOpen] = useState(false);
  const [mapMode, setMapMode] = useState<"reported" | "gps">("gps");
  const [cameraMode, setCameraMode] = useState<ForthMapCameraMode>("bangkok");
  const [mapDisplayFilter, setMapDisplayFilter] = useState<ForthMapDisplayFilter>("all");
  const [drivingOutsideOpen, setDrivingOutsideOpen] = useState(false);
  const [speedWatchOpen, setSpeedWatchOpen] = useState(false);
  const [speedConfigOpen, setSpeedConfigOpen] = useState(false);
  const [attentionOpen, setAttentionOpen] = useState(false);
  const [operationsMode, setOperationsMode] = useState(false);
  const [browserFullscreen, setBrowserFullscreen] = useState(false);
  // V21.2: Forth customer pins stay off by default so the fleet map stays clean.
  const [locationsLayerOn, setLocationsLayerOn] = useState(false);
  const [depotOfficeLayerOn, setDepotOfficeLayerOn] = useState(false);
  const [vehiclesLayerOn, setVehiclesLayerOn] = useState(true);
  const [locationsPanelOpen, setLocationsPanelOpen] = useState(true);
  const [locationsReload, setLocationsReload] = useState(0);
  const [directoryLocations, setDirectoryLocations] = useState<FleetDirectoryLocation[]>([]);
  const [directoryLocationCount, setDirectoryLocationCount] = useState(0);
  const [directoryVerifiedCount, setDirectoryVerifiedCount] = useState(0);
  const [locationsAvailable, setLocationsAvailable] = useState(false);
  const [locationsLoadState, setLocationsLoadState] = useState<"loading" | "unauthorized" | "failed" | "storage_missing" | "directory_empty" | "no_destination_pins" | "pin_mismatch" | "ready">("loading");
  const [forthGpsLocations, setForthGpsLocations] = useState<ForthGpsMapLocation[]>([]);
  const [forthGpsGroups, setForthGpsGroups] = useState<string[]>([]);
  const [forthGpsLoadState, setForthGpsLoadState] = useState<"loading" | "ready" | "failed" | "unauthorized" | "invalid_source">("loading");
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [outsideCoreOpen, setOutsideCoreOpen] = useState(false);
  const [coordinateActionNote, setCoordinateActionNote] = useState<string | null>(null);
  const [monitorDisplay, setMonitorDisplay] = useState(() => readForthMonitorDisplay(typeof window === "undefined" ? null : safeLocalStorage));
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
  const moreTriggerRef = useRef<HTMLButtonElement | null>(null);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  const speedWatchReturnFocusRef = useRef<HTMLElement | null>(null);
  const returnFocusToMore = useCallback(() => { moreTriggerRef.current?.focus(); }, []);
  const openSpeedWatch = useCallback(() => {
    speedWatchReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : moreTriggerRef.current;
    setMoreOpen(false);
    setAttentionOpen(false);
    setSpeedWatchOpen((open) => !open);
  }, []);
  const closeSpeedWatch = useCallback(() => {
    setSpeedWatchOpen(false);
    speedWatchReturnFocusRef.current?.focus();
  }, []);

  const handleAttentionOpenChange = useCallback((next: boolean) => {
    setAttentionOpen(next);
    if (next) { setSpeedWatchOpen(false); setMoreOpen(false); setOffscreenOpen(false); setOutsideCoreOpen(false); }
  }, []);
  const diagnosticsCloseRef = useRef<HTMLButtonElement | null>(null);
  const diagnosticsDialogRef = useRef<HTMLElement | null>(null);
  const mobileListTriggerRef = useRef<HTMLButtonElement | null>(null);
  const mobileListSearchRef = useRef<HTMLInputElement | null>(null);
  const selectedRowRef = useRef<HTMLButtonElement | null>(null);
  const mobileListDialogRef = useRef<HTMLElement | null>(null);
  const diagnosticsWasOpenRef = useRef(false);
  const mobileListWasOpenRef = useRef(false);
  const suppressMonitorReturnFocusRef = useRef(false);
  const transientReturnFocusRef = useRef<HTMLElement | null>(null);
  const statusDiagnosticCancelRef = useRef<HTMLButtonElement | null>(null);
  const statusDiagnosticDialogRef = useRef<HTMLDivElement | null>(null);
  const statusDiagnosticMessageRef = useRef<HTMLParagraphElement | null>(null);
  const statusDiagnosticReturnFocusRef = useRef<HTMLElement | null>(null);
  const restoreStatusDiagnosticFocusRef = useRef(false);
  const statusDiagnosticConfirmationReturnStateRef = useRef<"ready" | "failed">("ready");
  const statusDiagnosticConfirmStartedRef = useRef(false);
  const statusDiagnosticInteractedRef = useRef(false);

  const closeTransientPanels = useCallback((returnFocus = false) => {
    setAttentionOpen(false);
    setSpeedWatchOpen(false);
    setMoreOpen(false);
    setOffscreenOpen(false);
    setSharedLocationKeys(null);
    if (returnFocus && transientReturnFocusRef.current?.isConnected) transientReturnFocusRef.current.focus();
  }, []);

  const openTransientPanel = useCallback((panel: "attention" | "speed" | "more" | "offscreen" | "shared", sharedKeys?: string[]) => {
    transientReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setAttentionOpen(panel === "attention");
    setSpeedWatchOpen(panel === "speed");
    setMoreOpen(panel === "more");
    setOffscreenOpen(panel === "offscreen");
    setSharedLocationKeys(panel === "shared" ? sharedKeys ?? null : null);
    setInspectorOpen(false);
    setMobileInspectorOpen(false);
    if (window.matchMedia("(max-width: 767px)").matches) {
      suppressMonitorReturnFocusRef.current = true;
      setMobileListOpen(false);
    }
  }, []);

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
    const open = inspectorOpen && workspaceMode === "vehicle";
    if (open) vehicleDetailsCloseRef.current?.focus();
    else if (drawerWasOpenRef.current) selectedRowRef.current?.focus();
    drawerWasOpenRef.current = open;
  }, [inspectorOpen, workspaceMode, selectedKey]);

  useEffect(() => {
    selectedRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [filter, mobileListOpen, search, selectedKey, sort, workspaceMode]);

  useEffect(() => {
    if (mobileListOpen) {
      mobileListWasOpenRef.current = true;
    } else if (mobileListWasOpenRef.current) {
      mobileListWasOpenRef.current = false;
      if (!suppressMonitorReturnFocusRef.current) mobileListTriggerRef.current?.focus();
      suppressMonitorReturnFocusRef.current = false;
    }
  }, [mobileListOpen]);

  useEffect(() => {
    if (
      !diagnosticsOpen &&
      !mobileListOpen &&
      !attentionOpen &&
      !speedWatchOpen &&
      !sharedLocationKeys &&
      !offscreenOpen &&
      !moreOpen &&
      !inspectorOpen &&
      !mobileInspectorOpen &&
      !playbackOverlay.active &&
      workspaceMode !== "playback"
    ) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (statusDiagnosticConfirmationOpen || event.defaultPrevented) return;
        if (attentionOpen) return; // The attention drawer restores its own launcher focus.
        if (speedWatchOpen) {
          event.preventDefault();
          closeSpeedWatch();
          return;
        }
        if (playbackOverlay.active || workspaceMode === "playback") {
          event.preventDefault();
          exitPlaybackRef.current();
          return;
        }
        if (diagnosticsOpen) setDiagnosticsOpen(false);
        else if (speedWatchOpen || sharedLocationKeys || offscreenOpen || moreOpen) {
          event.preventDefault();
          closeTransientPanels(true);
        }
        else if (inspectorOpen || mobileInspectorOpen) {
          setWorkspaceMode("overview");
          setInspectorOpen(false);
          setMobileInspectorOpen(false);
        } else if (window.matchMedia("(max-width: 767px)").matches) setMobileListOpen(false);
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
  }, [diagnosticsOpen, mobileListOpen, attentionOpen, speedWatchOpen, sharedLocationKeys, offscreenOpen, moreOpen, inspectorOpen, mobileInspectorOpen, statusDiagnosticConfirmationOpen, closeTransientPanels, closeSpeedWatch, playbackOverlay.active, workspaceMode]);

  useEffect(() => {
    if (!moreOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || moreMenuRef.current?.contains(event.target) || moreTriggerRef.current?.contains(event.target)) return;
      setMoreOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [moreOpen]);

  const applyFleetFilter = (nextFilter: ForthFleetFilter) => {
    if (playbackOverlay.active || workspaceMode === "playback") {
      clearPlaybackOverlay();
    }
    setWorkspaceMode("overview");
    setSpeedWatchOpen(false);
    setFilter(nextFilter);
  };

  /** A user selection focuses once; subsequent polling never issues a camera command. */
  const selectVehicle = useCallback((key: string, options?: { focusMap?: boolean }) => {
    playbackPanelRef.current?.clearPlayback();
    setPlaybackOverlay(createInactivePlaybackOverlay());
    setPlaybackCursorOverride(null);
    setAttentionOpen(false);
    setSharedLocationKeys(null);
    setSharedLocationQuery("");
    setMoreOpen(false);
    setSpeedWatchOpen(false);
    setSelectedKey(key);
    setDetailSection("overview");
    setWorkspaceVehicleId(null);
    setWorkspaceMode("vehicle");
    setVehiclesLayerOn(true);
    setMobileListOpen(true);
    setInspectorOpen(true);
    setMobileInspectorOpen(true);
    setOffscreenOpen(false);
    const record = data ? findForthFleetRecord(fleetRecords, key) : null;
    if (options?.focusMap !== false && record && getForthFleetMapRecords([record]).length > 0) {
      if (!isForthGpsPositionVerified(record)) setMapMode("reported");
      setCameraMode("selected");
      setMapCommand((current) => ({ type: "focus", sequence: current.sequence + 1, key, zoom: isForthGpsPositionVerified(record) ? 15 : 14 }));
    }
  }, [data, fleetRecords]);
  const focusVehicle = selectVehicle;
  const selectVisibleMapVehicle = (key: string) => {
    // A map selection must also be findable in Fleet Monitor when a prior
    // search or status filter had hidden its row.
    setSearch("");
    setFilter("all");
    selectVehicle(key);
  };

  const applyCameraMode = (mode: ForthMapCameraMode) => {
    setCameraMode(mode);
    setOffscreenOpen(false);
    setOutsideCoreOpen(false);
    setDrivingOutsideOpen(false);
    setSharedLocationKeys(null);
    if (mode === "bangkok") {
      setMapMode("reported");
      setMapDisplayFilter("all");
      setMapCommand((current) => ({ type: "bangkok", sequence: current.sequence + 1 }));
      return;
    }
    if (mode === "thailand_neighbours") {
      setMapMode("reported");
      setMapDisplayFilter("all");
      setMapCommand((current) => ({ type: "thailand_neighbours", sequence: current.sequence + 1 }));
      return;
    }
    if (mode === "full_fleet") {
      setMapMode("reported");
      setMapDisplayFilter("all");
      setMapCommand((current) => ({ type: "fit_all", sequence: current.sequence + 1 }));
      return;
    }
    if (mode === "driving") {
      setMapMode("reported");
      setMapDisplayFilter("driving");
      setMapCommand((current) => ({ type: "fit_all", sequence: current.sequence + 1 }));
      return;
    }
    if (mode === "gps_verified") {
      setMapMode("gps");
      setMapDisplayFilter("gps_verified");
      setMapCommand((current) => ({ type: "fit_all", sequence: current.sequence + 1 }));
      return;
    }
    if (mode === "selected" && selectedKey) {
      const record = data ? findForthFleetRecord(fleetRecords, selectedKey) : null;
      setMapCommand((current) => ({ type: "focus", sequence: current.sequence + 1, key: selectedKey, zoom: record && isForthGpsPositionVerified(record) ? 15 : 14 }));
    }
  };

  /** Optional map action — list Driving Now filter never moves the camera by itself. */
  const showDrivingOnMap = () => {
    setSharedLocationKeys(null);
    setOffscreenOpen(false);
    setOutsideCoreOpen(false);
    setDrivingOutsideOpen(false);
    applyCameraMode("driving");
  };

  const fitAllVehicles = () => {
    setSelectedKey(null);
    setInspectorOpen(false);
    setMobileInspectorOpen(false);
    setSharedLocationKeys(null);
    setOffscreenOpen(false);
    applyCameraMode("full_fleet");
  };

  const clearPlaybackOverlay = useCallback(() => {
    playbackPanelRef.current?.clearPlayback();
    setPlaybackOverlay(createInactivePlaybackOverlay());
    setPlaybackCursorOverride(null);
  }, []);

  const exitPlayback = useCallback(
    (requestedMode?: ForthWorkspaceMode | null) => {
      clearPlaybackOverlay();
      const target = resolveExitPlaybackTarget(requestedMode, playbackReturnMode, selectedKey);
      setWorkspaceMode(target);
      setSpeedWatchOpen(target === "speed");
      setMobileListOpen(true);
      if (target === "vehicle" && selectedKey) {
        applyCameraMode("selected");
      } else if (target === "locations" && selectedLocationId) {
        applyCameraMode("selected");
      } else {
        applyCameraMode("bangkok");
      }
    },
    // applyCameraMode is recreated each render; intentional for camera restore on exit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clearPlaybackOverlay, playbackReturnMode, selectedKey, selectedLocationId]
  );

  const enterPlayback = useCallback(() => {
    setPlaybackReturnMode(resolvePlaybackReturnMode(workspaceMode, selectedKey));
    setWorkspaceMode("playback");
    setSpeedWatchOpen(false);
    setMoreOpen(false);
    setAttentionOpen(false);
    setMobileListOpen(true);
  }, [selectedKey, workspaceMode]);

  exitPlaybackRef.current = exitPlayback;

  const showFleetOverview = () => {
    clearPlaybackOverlay();
    setWorkspaceMode("overview");
    setSpeedWatchOpen(false);
    setSelectedKey(null);
    setSelectedLocationId(null);
    setInspectorOpen(false);
    setMobileInspectorOpen(false);
    setSharedLocationKeys(null);
    applyCameraMode("bangkok");
  };

  if (!statusDiagnosticRunnerRef.current) {
    statusDiagnosticRunnerRef.current = createForthStatusDiagnosticRunner<StatusDiagnosticResult>({
      storage: {
        read: () => safeSessionStorage.getItem(FORTH_STATUS_DIAGNOSTIC_SESSION_KEY),
        write: (value) => safeSessionStorage.setItem(FORTH_STATUS_DIAGNOSTIC_SESSION_KEY, value)
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
      const registryPromise = loadEesFleetIdentities();
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
          setData((previous) => retainForthSnapshot(previous, payload));
          setSnapshotNow(Date.now());
          setRequestError(false);
          setRequestFailureReason("network");
          if (payload.connectionStatus !== "connected") {
            setMapMode("reported");
            setMapDisplayFilter("all");
          }
          if (payload.connectionStatus === "connected") {
            setSelectedKey((current) => current && payload.records.some((record, index) => getForthFleetRecordKey(record, index) === current) ? current : null);
          }
        }
      } catch {
        if (active) {
          // Keep the last good fleet snapshot so Forth GPS locations and last refresh age stay useful.
          setRequestError(true);
          setRequestFailureReason(timedOut ? "timeout" : failureReason);
          setMapMode("reported");
          setMapDisplayFilter("all");
        }
      } finally {
        window.clearTimeout(timeout);
        const registry = await registryPromise;
        if (active && registry) setEesVehicles(registry);
        inFlight = false;
        if (active) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    };

    let lastLoadStartedAt = 0;
    const loadIfDue = (force = false) => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (!force && lastLoadStartedAt && now - lastLoadStartedAt < VISIBLE_RELOAD_MIN_GAP_MS) return;
      lastLoadStartedAt = now;
      void load();
    };

    refreshRef.current = async () => {
      lastLoadStartedAt = Date.now();
      await load();
    };
    loadIfDue(true);
    let interval: number | null = window.setInterval(() => loadIfDue(false), POLL_INTERVAL_MS);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        if (interval == null) interval = window.setInterval(() => loadIfDue(false), POLL_INTERVAL_MS);
        loadIfDue(false);
        return;
      }
      if (interval != null) {
        window.clearInterval(interval);
        interval = null;
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      active = false;
      if (interval != null) window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
      requestController?.abort();
    };
  }, []);

  useEffect(() => {
    let active = true;
    const loadLocations = async () => {
      try {
        const { data: authData, error: authError } = await supabase.auth.getSession();
        if (authError || !authData.session?.access_token) {
          if (active) {
            setDirectoryLocations([]);
            setLocationsAvailable(false);
            setLocationsLoadState("unauthorized");
            setForthGpsLocations([]);
            setForthGpsLoadState("unauthorized");
          }
          return;
        }
        const headers = { Authorization: `Bearer ${authData.session.access_token}` };
        const [locationsResponse, pinsResponse, forthResponse] = await Promise.all([
          fetch("/api/locations", { cache: "no-store", headers }),
          fetch("/api/locations/map-pins", { cache: "no-store", headers }),
          fetch("/api/admin/forth-tracking/saved-locations", { cache: "no-store", headers })
        ]);

        if (forthResponse.ok) {
          const forthPayload = await forthResponse.json() as {
            locations?: ForthGpsMapLocation[];
            groups?: string[];
            directoryRecordCount?: number;
            validation?: { status?: string };
          };
          if (active) {
            const locations = Array.isArray(forthPayload.locations) ? forthPayload.locations : [];
            setForthGpsLocations(locations);
            setForthGpsGroups(Array.isArray(forthPayload.groups) ? forthPayload.groups : []);
            setForthGpsLoadState(
              forthPayload.validation?.status === "ready" && locations.length
                ? "ready"
                : "invalid_source"
            );
            if (typeof forthPayload.directoryRecordCount === "number") {
              setDirectoryLocationCount((current) => current || forthPayload.directoryRecordCount || 0);
            }
          }
        } else if (active) {
          setForthGpsLocations([]);
          setForthGpsLoadState(forthResponse.status === 401 || forthResponse.status === 403 ? "unauthorized" : "failed");
        }

        if (!locationsResponse.ok || !pinsResponse.ok) {
          if (active) {
            setDirectoryLocations([]);
            setLocationsAvailable(false);
            setLocationsLoadState(locationsResponse.status === 401 || locationsResponse.status === 403 || pinsResponse.status === 401 || pinsResponse.status === 403 ? "unauthorized" : "failed");
          }
          return;
        }
        const locationsPayload = await locationsResponse.json() as { locations?: unknown };
        const pinsPayload = await pinsResponse.json() as { pins?: unknown; storageReady?: boolean };
        const locations = Array.isArray(locationsPayload.locations) ? locationsPayload.locations : [];
        const pins = Array.isArray(pinsPayload.pins) ? pinsPayload.pins : [];
        if (!active) return;
        setDirectoryLocationCount(locations.length);
        setDirectoryVerifiedCount(locations.filter((location) => location && typeof location === "object" &&
          (location as { verification_status?: unknown }).verification_status === "verified").length);
        if (pinsPayload.storageReady === false) {
          setDirectoryLocations([]);
          setLocationsAvailable(false);
          setLocationsLoadState("storage_missing");
          return;
        }
        const mapped = joinMappedDirectoryLocations(locations as Parameters<typeof joinMappedDirectoryLocations>[0], pins as Parameters<typeof joinMappedDirectoryLocations>[1]);
        const destinationPins = pins.filter((pin) => pin && typeof pin === "object" && (pin as { pin_type?: unknown }).pin_type === "destination");
        setDirectoryLocations(mapped);
        setLocationsAvailable(true);
        setLocationsLoadState(mapped.length ? "ready" : !locations.length ? "directory_empty" : !destinationPins.length ? "no_destination_pins" : "pin_mismatch");
      } catch {
        if (active) {
          setDirectoryLocations([]);
          setLocationsAvailable(false);
          setLocationsLoadState("failed");
          setForthGpsLoadState((current) => (current === "ready" ? current : "failed"));
        }
      }
    };
    void loadLocations();
    return () => { active = false; };
  }, [locationsReload]);

  const connected = !requestError && data?.connectionStatus === "connected";
  const hasFleetSnapshot = fleetRecords.length > 0;
  const summary = useMemo(() => summarizeForthFleet(fleetRecords), [fleetRecords]);
  // V7.8.4: the whole fleet crossed once (reported activity x verification x freshness), and the same matrix for the vehicle category in scope,
  // which is what the verified-only map actually hides. Both add up to the vehicles counted.
  const liveMatrix = useMemo(() => liveStatusMatrix(fleetRecords), [fleetRecords]);
  const liveMatrixInScope = useMemo(() => liveStatusMatrix(fleetRecords.filter(record => vehicleCategory === "all" || getForthTrackingVehicleIdentity(record.vehicleRegistration).vehicleClass === vehicleCategory)), [fleetRecords, vehicleCategory]);
  const forthGpsAsDirectory = useMemo<FleetDirectoryLocation[]>(
    () => forthGpsLocations.map((location) => ({
      id: location.id,
      companyName: location.name,
      thaiName: location.thaiName,
      address: location.address?.trim() || `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`,
      province: null,
      category: location.groupLayer || "Other",
      googleMapsUrl: location.googleMapsUrl,
      latitude: location.latitude,
      longitude: location.longitude,
      directoryHref: location.googleMapsUrl
    })),
    [forthGpsLocations]
  );
  const recordKeysByReference = useMemo(() => {
    const keys = new Map<ForthFleetTrackingRecord, string>();
    for (const [index, record] of (fleetRecords).entries()) {
      keys.set(record, getForthFleetRecordKey(record, index));
    }
    return keys;
  }, [fleetRecords]);
  const visibleRecords = useMemo(
    () => sortForthFleetRecords(filterForthFleetRecords(fleetRecords.filter(record => vehicleCategory === "all" || getForthTrackingVehicleIdentity(record.vehicleRegistration).vehicleClass === vehicleCategory), search, filter, (record) => [
      confirmedAssignedDriver(record, eesVehicles)
    ]), sort),
    [fleetRecords, eesVehicles, filter, search, sort, vehicleCategory]
  );
  const allPositionedRecords = useMemo(() => getForthFleetMapRecords(fleetRecords), [fleetRecords]);
  const drivingMapRecords = useMemo(() => getForthDrivingMapRecords(fleetRecords), [fleetRecords]);
  const mapRecords = useMemo(() => {
    const modeRecords = getForthFleetMapModeRecords(fleetRecords.filter(record => vehicleCategory === "all" || getForthTrackingVehicleIdentity(record.vehicleRegistration).vehicleClass === vehicleCategory), mapMode === "gps" || mapDisplayFilter === "gps_verified" ? "gps" : "reported");
    const filtered = filterForthMapDisplayRecords(modeRecords, mapDisplayFilter === "gps_verified" ? "all" : mapDisplayFilter);
    if (!selectedKey) return filtered;
    const selected = findForthFleetRecord(fleetRecords, selectedKey);
    if (!selected || filtered.includes(selected)) return filtered;
    // Keep a focused vehicle visible even when the map display filter would hide it.
    return [...filtered, selected];
  }, [fleetRecords, mapDisplayFilter, mapMode, selectedKey, vehicleCategory]);
  const unmappedPositionCount = summary.total - allPositionedRecords.length;
  const emphasizedKeys = useMemo(() => {
    if (!search.trim() && filter === "all") return [] as string[];
    return visibleRecords.flatMap((record) => {
      const key = recordKeysByReference.get(record);
      return key ? [key] : [];
    });
  }, [filter, recordKeysByReference, search, visibleRecords]);
  const positionedMapRecords = useMemo(() => getForthFleetMapRecords(mapRecords), [mapRecords]);
  const mapInitialFrame = useMemo(
    () => getForthFleetMapInitialFrame(positionedMapRecords.map(({ position }) => position)),
    [positionedMapRecords]
  );
  const offscreenMapRecords = useMemo(() => {
    if (!visibleMapKeys) return [];
    const visible = new Set(visibleMapKeys);
    return positionedMapRecords.filter(({ key }) => !visible.has(key));
  }, [positionedMapRecords, visibleMapKeys]);
  const accuracyRecords = useMemo(() => {
    const query = accuracySearch.trim().toLocaleLowerCase();
    const records = fleetRecords;
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
  }, [accuracySearch, fleetRecords]);
  const selectedRecord = useMemo(() => {
    if (!selectedKey) return null;
    return findForthFleetRecord(fleetRecords, selectedKey);
  }, [fleetRecords, selectedKey]);
  const selectedVehicleIdentity = selectedRecord
    ? getForthTrackingVehicleIdentity(selectedRecord.vehicleRegistration)
    : null;
  const selectedLocationDescription = selectedRecord
    ? getForthLocationDescription(selectedRecord, language)
    : null;
  const selectedPositionAge = selectedRecord
    ? formatForthRelativeAge(selectedRecord.lastGpsTimestamp, Date.now(), language)
    : null;
  const selectedExactPositionTime = selectedRecord
    ? formatForthTrackingTime(selectedRecord.lastGpsTimestamp, language)
    : null;
  // Plain-language assessment; the verification rule itself (isForthGpsPositionVerified) is unchanged.
  const selectedGpsHealth = selectedRecord ? describeForthGpsHealth(selectedRecord, language) : null;
  // V7.1 shared vehicle selection for the historical workspaces. It never touches the live map and never reads evidence.
  const normaliseRegistration = (value: string | null | undefined) => (value ?? "").replace(/[s-]/g, "").toLocaleUpperCase();
  const selectWorkspaceVehicle = (registration: string) => {
    const wanted = normaliseRegistration(registration);
    if (!wanted) return false;
    const record = fleetRecords.find((candidate) => normaliseRegistration(candidate.vehicleRegistration) === wanted);
    const key = record ? recordKeysByReference.get(record) ?? null : null;
    if (key) { setSelectedKey(key); setWorkspaceVehicleId(null); return true; }
    const matches = (eesVehicles ?? []).filter((vehicle) => normaliseRegistration(vehicle.vehicle_reg) === wanted);
    if (matches.length === 1) { setSelectedKey(null); setWorkspaceVehicleId(matches[0].id); return true; }
    return false;
  };
  // One drill-down for the daily review and the recurring places: select the vehicle and open Daily Activity on the reviewed day.
  const openReviewedVehicleDay = (registration: string, reviewedDay: string) => {
    setReviewDrill({ registration, day: reviewedDay });
    setEvidenceScope({ from: reviewedDay, to: reviewedDay, day: reviewedDay });
    if (selectWorkspaceVehicle(registration)) goWorkspace("daily");
    else { setSearch(registration); goWorkspace("live"); }
  };
  // V7.7.1: Reports -> Fuel Intelligence (keeps the report period) or Daily Activity (one chosen day). Switching workspace never starts a Forth read.
  const openFuelOversightVehicle = (registration: string, target: "fuel" | "daily" | "journeys" | "route", scope: { from: string; to: string; day: string | null }) => {
    if (target === "daily" && scope.day) { openReviewedVehicleDay(registration, scope.day); return; }
    // V7.8.3: a historical route for one day opens the supervised playback with that day pre-filled. It reads Forth only when "Load Journey" is pressed.
    if (target === "route" && scope.day) { setEvidenceScope({ from: scope.day, to: scope.day, day: scope.day }); if (selectWorkspaceVehicle(registration)) openRouteMap({ day: scope.day, start: "00:00", end: "23:59" }); else { setSearch(registration); goWorkspace("live"); } return; }
    setEvidenceScope({ from: scope.from, to: scope.to, day: scope.to });
    if (target === "journeys" && scope.day) setEvidenceScope({ from: scope.day, to: scope.day, day: scope.day });
    if (selectWorkspaceVehicle(registration)) goWorkspace(target === "daily" ? "daily" : target === "journeys" ? "journeys" : "fuel");
    else { setSearch(registration); goWorkspace("live"); }
  };
  const openVehicleWorkspace = (registration: string, section: string) => {
    if (selectWorkspaceVehicle(registration)) goWorkspace(section);
    else { setSearch(registration); goWorkspace("live"); }
  };
  const selectedLiveStatus = useMemo(() => (selectedRecord ? describeLiveVehicle(selectedRecord) : null), [selectedRecord]);
  const lastGpsUpdate = formatForthTrackingTime(summary.latestCurrentGpsPosition, language);
  const selectedHasMapPosition = selectedRecord ? getForthFleetMapRecords([selectedRecord]).length > 0 : false;
  const selectedConfirmedDriver = selectedRecord ? confirmedAssignedDriver(selectedRecord, eesVehicles) : null;
  const selectedEesVehicle = selectedRecord ? matchedEesVehicle(selectedRecord, eesVehicles) : null;
  const activeEesVehicle = selectedEesVehicle ?? (workspaceVehicleId ? eesVehicles?.find((vehicle) => vehicle.id === workspaceVehicleId) ?? null : null);
  const vehicleOptions = useMemo<FleetVehicleOption[] | null>(() => {
    if (!eesVehicles) return null;
    const counts = new Map<string, number>();
    for (const vehicle of eesVehicles) { const reg = (vehicle.vehicle_reg ?? "").replace(/[s-]/g, "").toLocaleUpperCase(); counts.set(reg, (counts.get(reg) ?? 0) + 1); }
    return eesVehicles.filter((vehicle) => (vehicle.vehicle_reg ?? "").trim()).map((vehicle) => ({ id: vehicle.id, label: vehicle.vehicle_reg as string, ambiguous: (counts.get((vehicle.vehicle_reg ?? "").replace(/[s-]/g, "").toLocaleUpperCase()) ?? 0) > 1 })).sort((a, b) => a.label.localeCompare(b.label));
  }, [eesVehicles]);
  const selectedNearbyLocations = useMemo(
    () => {
      if (!selectedRecord) return [];
      const primary = forthGpsAsDirectory.length
        ? findNearbyLocationsForVehicle(selectedRecord, forthGpsAsDirectory, { limit: 3, maxDistanceKm: 25 })
        : [];
      if (primary.length) return primary;
      return findNearbyLocationsForVehicle(selectedRecord, directoryLocations, { limit: 3, maxDistanceKm: 25 });
    },
    [directoryLocations, forthGpsAsDirectory, selectedRecord]
  );
  const selectedDirectoryLocation = selectedLocationId
    ? directoryLocations.find((location) => location.id === selectedLocationId) ?? null
    : null;
  /** Full Forth layer when toggled on; otherwise only the focused search/selection pin. */
  const mapForthGpsLocations = useMemo(
    () => selectForthMapPaintLocations(forthGpsLocations, {
      layerOn: locationsLayerOn,
      selectedId: selectedLocationId
    }),
    [forthGpsLocations, locationsLayerOn, selectedLocationId]
  );
  const mapDirectoryLocations = useMemo(() => {
    if (locationsLayerOn) return directoryLocations;
    const depotOffice = depotOfficeLayerOn
      ? directoryLocations.filter((location) => isEesDepotOrOfficeCategory(location.category))
      : [];
    if (selectedDirectoryLocation && !depotOffice.some((location) => location.id === selectedDirectoryLocation.id)) {
      return [...depotOffice, selectedDirectoryLocation];
    }
    return depotOffice;
  }, [depotOfficeLayerOn, directoryLocations, locationsLayerOn, selectedDirectoryLocation]);
  const mapForthLocationsVisible = locationsLayerOn
    || mapForthGpsLocations.length > 0
    || mapDirectoryLocations.length > 0;
  const outsideCore = useMemo(
    () => classifyOutsideCoreOperations(allPositionedRecords.map(({ key, record }) => ({
      key,
      latitude: record.latitude as number,
      longitude: record.longitude as number
    }))),
    [allPositionedRecords]
  );
  const outsideCoreRecords = useMemo(() => {
    const keys = new Set(outsideCore.outside);
    return allPositionedRecords.filter(({ key }) => keys.has(key));
  }, [allPositionedRecords, outsideCore.outside]);
  const drivingOutsideViewport = useMemo(
    () => classifyDrivingOutsideViewport(
      drivingMapRecords.map(({ key, record }) => ({
        key,
        latitude: record.latitude as number,
        longitude: record.longitude as number
      })),
      visibleMapKeys
    ),
    [drivingMapRecords, visibleMapKeys]
  );
  const drivingOutsideCore = useMemo(
    () => classifyDrivingOutsideCoreOperations(
      drivingMapRecords.map(({ key, record }) => ({
        key,
        latitude: record.latitude as number,
        longitude: record.longitude as number
      }))
    ),
    [drivingMapRecords]
  );
  const drivingOutsideKeys = mapDisplayFilter === "driving" || cameraMode === "driving"
    ? drivingOutsideViewport.outside
    : cameraMode === "bangkok"
      ? drivingOutsideCore.outside
      : drivingOutsideViewport.outside;
  const drivingOutsideRecords = useMemo(() => {
    const keys = new Set(drivingOutsideKeys);
    return drivingMapRecords.filter(({ key }) => keys.has(key));
  }, [drivingMapRecords, drivingOutsideKeys]);
  const mapViewLabel = resolveForthMapViewLabel({
    cameraMode,
    mapMode,
    displayFilter: mapDisplayFilter,
    selectedKey
  });
  const mapViewLabelText = mapViewLabel === "driving"
    ? copy.mapShowingDriving
    : mapViewLabel === "selected"
      ? copy.mapShowingSelected
      : mapViewLabel === "gps_verified"
        ? copy.mapShowingGps
        : mapViewLabel === "all_fleet"
          ? copy.mapShowingFleet
          : copy.mapShowingCore;
  const focusSelectedOnMap = () => {
    if (!selectedKey || !selectedHasMapPosition || !selectedRecord) return;
    if (!isForthGpsPositionVerified(selectedRecord)) setMapMode("reported");
    setCameraMode("selected");
    setMapCommand((current) => ({ type: "focus", sequence: current.sequence + 1, key: selectedKey, zoom: isForthGpsPositionVerified(selectedRecord) ? 15 : 14 }));
  };
  const copySelectedCoordinates = async () => {
    if (!selectedRecord || selectedRecord.latitude === null || selectedRecord.longitude === null) return;
    const text = forthReportedCoordinateClipboardText(selectedRecord.latitude, selectedRecord.longitude);
    if (!text || !navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(text);
      setCoordinateActionNote(language === "th"
        ? `คัดลอกพิกัด Forth แล้ว${isForthGpsPositionVerified(selectedRecord) ? "" : " (ยังไม่ยืนยัน GPS)"}`
        : `Copied Forth coordinates${isForthGpsPositionVerified(selectedRecord) ? "" : " (GPS not verified)"}`);
    } catch {
      setCoordinateActionNote(language === "th" ? "คัดลอกพิกัดไม่สำเร็จ" : "Could not copy coordinates");
    }
  };
  const openSelectedCoordinatesExternally = () => {
    if (!selectedRecord || selectedRecord.latitude === null || selectedRecord.longitude === null) return;
    const url = forthReportedCoordinateMapsUrl(selectedRecord.latitude, selectedRecord.longitude);
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  };
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
    uncertain: copy.activityUncertain,
    stopped: copy.mapParked,
    unavailable: copy.mapUnknown,
    gpsVerified: copy.gpsPositionVerified,
    notGpsVerified: copy.gpsPositionUnverified,
    groupVehicles: copy.groupVehicles,
    expandGroup: language === "th" ? "เลือกทะเบียนจากรายการ" : "Choose a registration",
    sharedLocation: language === "th" ? "รถที่ใช้ตำแหน่งรายงานนี้" : "Vehicles at this reported position",
    engineOn: copy.engineOn,
    engineOff: copy.engineOff,
    unknownValue: copy.unknownValue,
    noPositions: mapMode === "gps"
      ? language === "th" ? "ยังไม่มีตำแหน่ง GPS ปัจจุบันที่ยืนยันแล้ว" : "No current GPS-verified positions. Switch to All reported to review other positions."
      : language === "th" ? "ไม่มีพิกัดรายงานที่ใช้ได้ ดูรถทั้งหมดในจอภาพกองรถ" : "No valid reported coordinates. All vehicles remain in Fleet Monitor.",
    loading: copy.mapLoading,
    mapUnavailable: copy.mapUnavailable,
    mapRegionLabel: copy.mapRegionLabel
  }), [copy, language, mapMode]);
  const mapConfirmedDriverFor = useCallback((record: ForthFleetTrackingRecord) => confirmedAssignedDriver(record, eesVehicles), [eesVehicles]);

  useEffect(() => {
    const syncFullscreen = () => setBrowserFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      // The mode remains usable when the browser blocks full-screen.
    }
  };

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

  const drawerOpen = Boolean(selectedRecord && workspaceMode === "vehicle" && inspectorOpen);
  const WORKSPACE_IDS = ["live", "daily", "journeys", "fuel", "reports"];
  const workspaceUrl = (id: string, registration: string | null) => {
    const url = new URL(window.location.href);
    url.searchParams.set("view", id);
    if (registration) url.searchParams.set("vehicle", registration); else url.searchParams.delete("vehicle");
    // V7.8.4: the selected date range travels with the vehicle (dates only), so reload and back/forward open the same period.
    const withScope = withScopeParams(url, evidenceScope);
    return withScope.pathname + withScope.search;
  };
  /** Switching a workspace only changes what is shown. It keeps the vehicle and date scope and never starts a read. */
  const goWorkspace = (id: string, options?: { fromHistory?: boolean }) => {
    setIntelligenceSection(id);
    setSpeedWatchOpen(false);
    setMoreOpen(false);
    setAttentionOpen(false);
    setRouteMapOpen(false);
    if (playbackOverlay.active || workspaceMode === "playback") clearPlaybackOverlay();
    if (id === "live") {
      setWorkspaceMode(selectedKey ? "vehicle" : "overview");
      setInspectorOpen(Boolean(selectedKey));
      setMobileInspectorOpen(Boolean(selectedKey));
      setDetailSection("overview");
      if (selectedKey) applyCameraMode("selected");
    } else if (workspaceMode === "playback") setWorkspaceMode("overview");
    if (!options?.fromHistory && typeof window !== "undefined") {
      const next = workspaceUrl(id, selectedRecord?.vehicleRegistration ?? activeEesVehicle?.vehicle_reg ?? null);
      if (next !== window.location.pathname + window.location.search) window.history.pushState({ fleetView: id }, "", next);
    }
  };
  const chooseWorkspaceVehicle = (id: string) => {
    const vehicle = eesVehicles?.find((candidate) => candidate.id === id);
    if (!vehicle) { setSelectedKey(null); setWorkspaceVehicleId(null); return; }
    if (!selectWorkspaceVehicle(vehicle.vehicle_reg ?? "")) { setSelectedKey(null); setWorkspaceVehicleId(vehicle.id); }
  };
  /** Opens the route map on demand from Journeys; the existing supervised playback panel and its access checks are unchanged. */
  const [routeRange, setRouteRange] = useState<{ nonce: number; day: string; start: string; end: string } | null>(null);
  /** Opens the supervised route playback. A movement chosen in Daily Activity only pre-fills its date and time window; nothing is read until the existing load button is used. */
  const openRouteMap = (range?: unknown) => {
    const r = range as { day?: unknown; start?: unknown; end?: unknown } | undefined;
    if (r && typeof r.day === "string" && typeof r.start === "string" && typeof r.end === "string") setRouteRange(prev => ({ nonce: (prev?.nonce ?? 0) + 1, day: r.day as string, start: r.start as string, end: r.end as string }));
    setRouteMapOpen(true); enterPlayback();
  };
  const leaveRouteMap = () => { exitPlayback("overview"); setRouteMapOpen(false); };
  const showMapShell = intelligenceSection === "live" || routeMapOpen;
  const goWorkspaceRef = useRef(goWorkspace);
  goWorkspaceRef.current = goWorkspace;
  const selectWorkspaceVehicleRef = useRef(selectWorkspaceVehicle);
  selectWorkspaceVehicleRef.current = selectWorkspaceVehicle;
  // URL <-> workspace (?view=daily&vehicle=68-7154). Back and forward move between workspaces and never start a read.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const view = params.get("view");
    if (view && view !== "live" && WORKSPACE_IDS.includes(view)) setIntelligenceSection(view);
    pendingUrlVehicleRef.current = params.get("vehicle");
    const urlScope = parseScopeParams(params);
    if (urlScope) setEvidenceScope(urlScope);
    const onPop = () => {
      const query = new URLSearchParams(window.location.search);
      const next = query.get("view");
      goWorkspaceRef.current(next && WORKSPACE_IDS.includes(next) ? next : "live", { fromHistory: true });
      const registration = query.get("vehicle");
      if (registration) selectWorkspaceVehicleRef.current(registration);
      const popped = parseScopeParams(query);
      if (popped) setEvidenceScope(prev => (prev && prev.from === popped.from && prev.to === popped.to ? prev : popped));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Keeps the address bar in step with the chosen period (replace, not push: changing dates must not add history entries).
  useEffect(() => {
    if (!evidenceScope || typeof window === "undefined") return;
    const here = new URL(window.location.href);
    if (here.searchParams.get("from") === evidenceScope.from && here.searchParams.get("to") === evidenceScope.to) return;
    const next = withScopeParams(here, evidenceScope);
    window.history.replaceState(window.history.state, "", next.pathname + next.search);
  }, [evidenceScope]);
  useEffect(() => {
    const registration = pendingUrlVehicleRef.current;
    if (!registration || fleetRecords.length === 0 || !eesVehicles) return;
    pendingUrlVehicleRef.current = null;
    selectWorkspaceVehicleRef.current(registration);
  }, [fleetRecords, eesVehicles]);
  const activeFilterCount = (filter !== "all" ? 1 : 0) + (vehicleCategory !== "all" ? 1 : 0) + (sort !== "operations" ? 1 : 0);
  const kpiReady = connected || hasFleetSnapshot;
  const detailTabs: ReadonlyArray<readonly [string, string, string]> = [["overview", "Overview", "ภาพรวม"], ["today", "Today", "วันนี้"], ["journeys", "Journeys", "เส้นทาง"], ["jobs", "Jobs", "งาน"], ["fuel", "Fuel", "เชื้อเพลิง"], ["health", "GPS Health", "สถานะ GPS"]];
  const onDetailTabKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    const ids = detailTabs.map(([id]) => id);
    const index = ids.indexOf(detailSection);
    let next = -1;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % ids.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + ids.length) % ids.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = ids.length - 1;
    if (next < 0) return;
    event.preventDefault();
    setDetailSection(ids[next]);
    window.requestAnimationFrame(() => document.getElementById(`forth-detail-tab-${ids[next]}`)?.focus());
  };

  const gpsHealthNode = selectedRecord ? (
<div className="fleet-gps-health-view">
                <h3>{language === "th" ? "สถานะ GPS และความน่าเชื่อถือของตำแหน่ง" : "GPS health and position reliability"}</h3>
                {selectedGpsHealth && gpsSummaryFor(selectedGpsHealth.letter, language === "th" ? "th" : "en") ? (() => { const g = gpsSummaryFor(selectedGpsHealth.letter, language === "th" ? "th" : "en")!; return <p className="fleet-gps-summary" data-gps-summary data-tone={g.tone} role="status"><strong>{g.title}</strong>{g.meaning}</p>; })() : null}
                <div className="grid gap-2 text-xs">
                      <p className="min-w-0"><span className="block font-semibold text-slate-500">{copy.device}</span><span className="break-all font-mono text-slate-700">{selectedRecord.gpsDeviceId || copy.unknownValue}</span></p>
                      <p className="min-w-0"><span className="block font-semibold text-slate-500">{copy.reportedCoordinates}</span><span className="break-all font-mono text-slate-700">{selectedRecord.coordinateStatus === "valid" && selectedRecord.latitude !== null && selectedRecord.longitude !== null ? `${selectedRecord.latitude.toFixed(5)}, ${selectedRecord.longitude.toFixed(5)}` : copy.noPosition}</span></p>
                      <p className="min-w-0"><span className="block font-semibold text-slate-500">{copy.heading}</span><span className="text-slate-700">{selectedRecord.heading === null ? copy.unknownValue : `${selectedRecord.heading} ${copy.degrees}`}</span></p>
                      <p className="min-w-0"><span className="block font-semibold text-slate-500">{copy.positionSource}</span><span className="text-slate-700">{shortPositionQualityLabel(selectedRecord, copy)}</span></p>
                      <p className="min-w-0"><span className="block font-semibold text-slate-500">{language === "th" ? "สัญญาณ GPS ที่ Forth รายงาน" : "GPS signal reported by Forth"}</span><ConnectivityValue connected={selectedRecord.gpsConnectivity} copy={copy} connectedLabel={copy.available} disconnectedLabel={copy.gpsNoFix} /></p>
                      {selectedGpsHealth ? <p className="min-w-0" data-health={selectedGpsHealth.letter}><span className="block font-semibold text-slate-500">{language === "th" ? "การประเมินสถานะ GPS ของ EES" : "EES GPS health assessment"}</span><span className="text-slate-800">{selectedGpsHealth.letter} · {selectedGpsHealth.title}</span><span className="block text-slate-600">{selectedGpsHealth.signalSummary}</span><span className="block text-slate-600">{selectedGpsHealth.reason}</span><span className="block text-slate-600">{language === "th" ? "เวลาตำแหน่ง" : "Position time"}: {selectedGpsHealth.positionTime ?? "—"}{selectedPositionAge ? ` · ${selectedPositionAge}` : ""} · Asia/Bangkok</span></p> : null}
                      {selectedRecord.sourceTimestampRaw ? <p className="min-w-0"><span className="block font-semibold text-slate-500">{copy.sourceTimestamp}</span><span className="break-words font-mono text-slate-700">{selectedRecord.sourceTimestampRaw}</span></p> : null}
                      {selectedRecord.positionQuality === "no_gps" ? <p className="text-xs leading-5 text-amber-800">{copy.noGpsSourceNote}</p> : null}
                      {!isForthGpsPositionVerified(selectedRecord) && selectedRecord.positionQuality !== "no_gps" ? <p className="text-xs leading-5 text-amber-800">{copy.approximateCoordinatesNote}</p> : null}
                    </div>
                <div className="grid gap-2 text-xs">
                  <p className="min-w-0"><span className="block font-semibold text-slate-500">{language === "th" ? "ตัวติดตาม (GPRS) ที่ Forth รายงาน" : "Tracker connection (GPRS) reported by Forth"}</span><ConnectivityValue connected={selectedRecord.gprsConnectivity} copy={copy} /></p>
                  <p className="min-w-0"><span className="block font-semibold text-slate-500">{language === "th" ? "ความสดของตำแหน่ง" : "Timestamp freshness"}</span><span className="text-slate-800">{selectedExactPositionTime ?? timestampStatusLabel(selectedRecord, copy)}{selectedPositionAge ? ` · ${copy.reportAge}: ${selectedPositionAge}` : ""}</span></p>
                  <p className="min-w-0"><span className="block font-semibold text-slate-500">{language === "th" ? "การจัดประเภทแหล่งพิกัด" : "Coordinate source classification"}</span><span className="text-slate-800">{isForthGpsPositionVerified(selectedRecord) ? (language === "th" ? "GPS ที่ยืนยัน (แหล่งตำแหน่ง = GPS)" : "Verified GPS (position source = GPS)") : selectedRecord.positionQuality === "no_gps" ? (language === "th" ? "ตำแหน่งที่รายงาน ไม่ใช่ GPS (แหล่งตำแหน่ง = No GPS)" : "Reported position, not GPS (position source = No GPS)") : (language === "th" ? "ตำแหน่งโดยประมาณ ยังไม่ยืนยัน" : "Approximate or unverified position")}</span></p>
                </div>
              </div>
  ) : null;

  const headerNode = (
        <header className="forth-float-toolbar forth-command-strip fleet-v7-header">
          <div className="v7-header-row">
            <button ref={mobileListTriggerRef} type="button" className="v7-vehicles-toggle" onClick={() => setMobileListOpen((open) => !open)} aria-expanded={mobileListOpen} aria-controls="forth-operations-sidebar" title={language === "th" ? "แสดง/ซ่อนรายการรถ" : "Show or hide the vehicle list"}>
              <PanelLeft className="h-4 w-4" aria-hidden="true" />
              <span>{language === "th" ? "รถ" : "Vehicles"}</span>
            </button>
            <div className="forth-float-title">
              <h1>{copy.title}</h1>
            </div>
            <div className="forth-live-status" role="status" title={lastChecked ?? undefined}>
              <span className={connected ? "forth-status-indicator is-live" : "forth-status-indicator"} aria-hidden="true" />
              <strong>
                {connected ? copy.connected : data?.connectionStatus === "not_configured" ? copy.disconnected : data?.connectionStatus === "failed" || requestError ? copy.unavailable : copy.mapLoading}
                {!connected && hasFleetSnapshot ? (language === "th" ? " · ข้อมูลล่าสุด" : " · last snapshot") : ""}
              </strong>
              {lastRefreshAge ? <span className="v7-freshness">Forth · {lastRefreshAge}</span> : null}
            </div>
            <nav className="v7-workspace-nav" aria-label={language === "th" ? "พื้นที่ปฏิบัติการ" : "Operations navigation"}>
              {[["live", "Live Fleet", "กองรถสด"], ["daily", "Daily Activity", "กิจกรรมประจำวัน"], ["journeys", "Journeys & Jobs", "เส้นทางและงาน"], ["fuel", "Fuel Intelligence", "ข้อมูลเชื้อเพลิง"], ["reports", "Reports", "รายงาน"]].map(([id, en, th]) => <button key={id} type="button" aria-pressed={intelligenceSection === id} onClick={() => goWorkspace(id)}>{language === "th" ? th : en}</button>)}
            </nav>
            <div className="forth-float-actions v7-actions" role="toolbar" aria-label={copy.opsStrip}>
              <ForthFleetAlerts hideLauncher onReturnFocus={returnFocusToMore} records={fleetRecords} available={connected} language={language} open={attentionOpen} onOpenChange={handleAttentionOpenChange} onSelect={(key) => selectVehicle(key)} onFilter={(next) => { applyFleetFilter(next); setMobileListOpen(true); }} />
              <button type="button" className="btn-secondary forth-command-button is-primary" onClick={() => void refreshRef.current()} disabled={refreshing || loading}>
                <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
                <span>{refreshing ? copy.refreshing : copy.refresh}</span>
              </button>
              <button ref={moreTriggerRef} type="button" className="btn-secondary forth-command-button forth-more-trigger" aria-expanded={moreOpen} aria-controls="forth-more-menu" aria-haspopup="dialog" onClick={(event) => { if (!moreOpen) transientReturnFocusRef.current = event.currentTarget; setMoreOpen((open) => !open); }}>
                <Wrench className="h-4 w-4" aria-hidden="true" />
                <span>{language === "th" ? "เครื่องมือ" : "Tools"}</span>
                <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
          <div className="v7-kpi-row">
            <div className="forth-tracking-kpis" role="group" aria-label={copy.opsStrip}>
              <button type="button" className="forth-stat is-fleet" aria-pressed={filter === "all"} disabled={!kpiReady} onClick={() => { applyFleetFilter("all"); setMobileListOpen(true); }}><strong>{kpiReady ? summary.total : "—"}</strong><span>{language === "th" ? "รถที่ติดตาม" : "Tracked"}</span></button>
              <button type="button" className="forth-stat is-moving" aria-pressed={filter === "driving"} disabled={!kpiReady} title={copy.movingHelper} onClick={() => { applyFleetFilter(filter === "driving" ? "all" : "driving"); setMobileListOpen(true); }}><strong>{kpiReady ? summary.reportedActivity.driving : "—"}</strong><span>{language === "th" ? "เคลื่อนที่" : "Moving"}</span></button>
              <button type="button" className="forth-stat is-stopped" aria-pressed={filter === "stopped"} disabled={!kpiReady} title={copy.parkedHelper} onClick={() => { applyFleetFilter(filter === "stopped" ? "all" : "stopped"); setMobileListOpen(true); }}><strong>{kpiReady ? summary.reportedActivity.stopped : "—"}</strong><span>{language === "th" ? "หยุดนิ่ง" : "Stationary"}</span></button>
              <button type="button" className="forth-stat is-gps-off" aria-pressed={filter === "unverified"} disabled={!kpiReady} title={language === "th" ? "พิกัดรายงาน แต่ยังไม่ยืนยัน GPS (ไม่ใช่ออฟไลน์)" : "Reported coordinates without GPS verification (not the same as offline)"} onClick={() => { applyFleetFilter(filter === "unverified" ? "all" : "unverified"); setMobileListOpen(true); }}><strong>{kpiReady ? summary.positionConfidence.notGpsVerified : "—"}</strong><span>{language === "th" ? "GPS ไม่ยืนยัน" : "GPS unverified"}</span></button>
              <button type="button" className="forth-stat is-attention" aria-pressed={filter === "attention"} disabled={!kpiReady} title={copy.needsAttentionHelper} onClick={() => { applyFleetFilter(filter === "attention" ? "all" : "attention"); setMobileListOpen(true); setAttentionOpen(true); }}><strong>{kpiReady ? summary.needsAttention : "—"}</strong><span>{copy.needsAttention}</span></button>
            </div>
            <button type="button" className="v7-verified-chip" aria-pressed={filter === "verified"} disabled={!kpiReady} title={language === "th" ? "ตำแหน่งที่ยืนยันด้วย GPS (ไม่เหมือนกับสถานะการทำงานที่อุปกรณ์รายงาน)" : "GPS-verified positions (not the same as device-reported activity)"} onClick={() => { applyFleetFilter(filter === "verified" ? "all" : "verified"); setMobileListOpen(true); }}>
              <strong>{kpiReady ? summary.currentGpsVerifiedPositions : "—"}</strong> {copy.gpsVerifiedStat}
            </button>
          </div>
          {kpiReady && liveMatrix.total > 0 ? (
            <p className="v784-live-matrix" data-live-matrix data-partitions={liveMatrix.partitions ? "true" : "false"} aria-label={language === "th" ? "สถานะรถแยกตามกิจกรรมที่รายงานและการยืนยัน GPS" : "Vehicles by reported activity and GPS verification"}>
              {LIVE_CELLS.filter(cell => liveMatrix.cells[cell] > 0).map(cell => <span key={cell} className={`v784-live-cell is-${cell}`} title={LIVE_CELL_COPY[cell].help[language === "th" ? 1 : 0]}><strong>{liveMatrix.cells[cell]}</strong> {LIVE_CELL_COPY[cell].label[language === "th" ? 1 : 0]}</span>)}
              <span className="v784-live-total">= {liveMatrix.total} {language === "th" ? "คันที่ติดตาม" : "tracked"}{liveMatrix.needsAttention > 0 ? ` · ${liveMatrix.needsAttention} ${language === "th" ? "ควรตรวจสอบ (ซ้อนทับกับข้างต้น)" : "need attention (overlaps the above)"}` : ""}</span>
            </p>
          ) : null}
          {data?.connectionStatus === "not_configured" || data?.connectionStatus === "failed" || requestError ? (
            <p className={`forth-connection-note ${data?.connectionStatus === "not_configured" ? "bg-amber-50 text-amber-950" : "bg-rose-50 text-rose-950"}`} role="status">
              <strong>{data?.connectionStatus === "not_configured" ? copy.configurationTitle : copy.failureTitle}. </strong>
              {data?.connectionStatus === "not_configured" ? copy.configurationBody : trackingMessage}
              {requestError && lastChecked ? <span> {copy.staleSnapshotHidden} {lastChecked}</span> : null}
            </p>
          ) : null}
          {moreOpen ? (
            <div ref={moreMenuRef} id="forth-more-menu" className="forth-more-menu" role="dialog" aria-label={copy.mapViews}>
              <div className="forth-more-heading"><strong>{language === "th" ? "เครื่องมือกองรถ" : "Fleet tools"}</strong><button type="button" aria-label={language === "th" ? "ปิด" : "Close"} onClick={() => setMoreOpen(false)}><X className="h-4 w-4" /></button></div>
              <div className="forth-more-primary">
                <ForthSpeedWatchLauncher
                  records={fleetRecords}
                  available={connected || hasFleetSnapshot}
                  language={language}
                  pressed={speedWatchOpen}
                  onClick={openSpeedWatch}
                />
                <button type="button" className="btn-secondary" onClick={() => { setMoreOpen(false); setSpeedWatchOpen(false); setOffscreenOpen(false); setOutsideCoreOpen(false); setInspectorOpen(false); setMobileInspectorOpen(false); setAttentionOpen(true); }}>{copy.attention}</button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    if (playbackOverlay.active || workspaceMode === "playback") exitPlayback("locations");
                    else { setWorkspaceMode("locations"); setSpeedWatchOpen(false); }
                    setLocationsPanelOpen(true);
                    setMobileListOpen(true);
                    setMoreOpen(false);
                  }}
                >
                  {language === "th" ? "ค้นหาสถานที่" : "Search locations"}
                  {forthGpsLoadState === "ready" ? <strong>{forthGpsLocations.length}</strong> : null}
                </button>
                <button type="button" className="btn-secondary" aria-pressed={locationsLayerOn} onClick={() => { setLocationsLayerOn((value) => !value); setMoreOpen(false); }}>
                  {language === "th" ? "หมุดลูกค้าบนแผนที่" : "Customer pins on map"}
                  <strong>{locationsLayerOn ? "on" : "off"}</strong>
                </button>
                <button type="button" className="btn-secondary" aria-pressed={vehiclesLayerOn} onClick={() => { setVehiclesLayerOn((value) => !value); setMoreOpen(false); }}>
                  {language === "th" ? "แสดงรถ" : "Show vehicles"}
                </button>
                <button type="button" className="btn-secondary" disabled={!connected && !hasFleetSnapshot} onClick={() => { applyFleetFilter("engine_on_stopped"); setMobileListOpen(true); setMoreOpen(false); }}>
                  {language === "th" ? "จอด·เครื่องติด" : "Engine-on stopped"}
                  <strong>{connected || hasFleetSnapshot ? summary.reportedActivity.stoppedEngineOn : "—"}</strong>
                </button>
                <Link href="/fleet-events" className="btn-secondary" onClick={() => setMoreOpen(false)}>{language === "th" ? "เหตุการณ์สถานที่" : "Location events"}</Link>
              </div>
              <p className="forth-more-sync-note">{language === "th" ? "ตำแหน่ง GPS ที่ยืนยันล่าสุด" : "Latest GPS-verified position"}: {lastGpsUpdate ?? copy.unknownValue}</p>
              <div className="forth-more-section-label">{language === "th" ? "มุมมองแผนที่" : "Map views"}</div>
              <button type="button" className="forth-more-map-view" onClick={() => { setMoreOpen(false); applyCameraMode("thailand_neighbours"); }}><MapPinned className="h-4 w-4" />{language === "th" ? "ไทยและเพื่อนบ้าน" : "Thailand & neighbours"}</button>
              <div className="forth-more-view-options">
                <button type="button" className="btn-secondary min-h-10 gap-2 px-3 text-sm" aria-pressed={operationsMode} onClick={() => { setOperationsMode((current) => !current); setMoreOpen(false); }}>{operationsMode ? (language === "th" ? "มุมมองปกติ" : "Standard view") : (language === "th" ? "โหมดปฏิบัติการ" : "Operations Mode")}</button>
                <button type="button" className="btn-secondary min-h-10 gap-2 px-3 text-sm" aria-pressed={browserFullscreen} onClick={() => { void toggleFullscreen(); setMoreOpen(false); }}>{browserFullscreen ? (language === "th" ? "ออกจากเต็มจอ" : "Exit full screen") : (language === "th" ? "เต็มจอ" : "Full screen")}</button>
              </div>
              {connected && can("business:read") ? <button type="button" className="forth-more-map-view" onClick={() => { setMoreOpen(false); setSpeedConfigOpen(true); }}><Gauge className="h-4 w-4" />{copy.speedSettings}</button> : null}
              {connected && can("business:read") ? <button ref={diagnosticsTriggerRef} type="button" className="forth-more-map-view" onClick={() => { setMoreOpen(false); setDiagnosticsOpen(true); }}><Activity className="h-4 w-4" />{language === "th" ? "การวินิจฉัย" : "Diagnostics"}</button> : null}
              <details className="mt-3 text-sm text-slate-700">
                <summary className="cursor-pointer font-semibold text-violet-800">{copy.mapLegendHelp}</summary>
                <div className="mt-2 space-y-1 text-xs leading-5">
                  <p>{copy.mapMoving} · {copy.mapParked}</p>
                  <p>{copy.mapConfidence}</p>
                  <p>{copy.mapGroupHelp}</p>
                  <p>{copy.mapEngineOnStop} · {copy.mapEngineOffStop} · {copy.mapEngineUnknownStop}</p>
                  <p>{copy.mapConflictLegend} {copy.activityConflictNote}</p>
                  <p>{copy.mapOfflineLegend} · {copy.mapSelectedLegend}</p>
                  <p>{copy.mapUnknown}</p>
                </div>
              </details>
              <details className="mt-3 text-sm text-slate-700">
                <summary className="cursor-pointer font-semibold text-violet-800">{language === "th" ? "การแสดงผลจอภาพกองรถ" : "Fleet Monitor display"}</summary>
                <div className="mt-2 grid gap-1.5 text-xs">
                  <div className="flex flex-wrap gap-1.5">
                    {([
                      ["operations", copy.displayPresetOps, FORTH_MONITOR_DISPLAY_OPERATIONS],
                      ["detailed", copy.displayPresetDetailed, FORTH_MONITOR_DISPLAY_DETAILED]
                    ] as const).map(([id, label, preset]) => (
                      <button
                        key={id}
                        type="button"
                        className={`rounded-md border px-2 py-1 font-semibold ${resolveForthMonitorDisplayPreset(monitorDisplay) === id ? "border-violet-400 bg-violet-50 text-violet-900" : "border-slate-200 bg-white text-slate-700"}`}
                        onClick={() => {
                          setMonitorDisplay(preset);
                          writeForthMonitorDisplay(safeLocalStorage, preset);
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {([
                    ["driver", language === "th" ? "คนขับ" : "Driver"],
                    ["location", language === "th" ? "พื้นที่" : "Location"],
                    ["speed", language === "th" ? "ความเร็ว" : "Speed"],
                    ["engine", language === "th" ? "เครื่องยนต์" : "Engine"],
                    ["gpsConfidence", language === "th" ? "ความมั่นใจ GPS" : "GPS confidence"],
                    ["reportAge", language === "th" ? "อายุรายงาน" : "Report age"]
                  ] as Array<[ForthMonitorDisplayField, string]>).map(([field, label]) => (
                    <label key={field} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={monitorDisplay[field]}
                        onChange={(event) => {
                          const next = { ...monitorDisplay, [field]: event.target.checked };
                          setMonitorDisplay(next);
                          writeForthMonitorDisplay(safeLocalStorage, next);
                        }}
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                  <p className="text-[11px] leading-4 text-slate-500">{language === "th" ? "แสดงเฉพาะข้อมูลที่มีจริง ไม่สร้างค่าเซ็นเซอร์ · บันทึกในเบราว์เซอร์นี้" : "Only real Forth/EES fields. Saved in this browser. No invented sensor values."}</p>
                </div>
              </details>
            </div>
          ) : null}
        </header>
  );

  return (
    <main translate="no" lang={language} className={`forth-tracking-workspace forth-v21 fleet-v7${operationsMode ? " is-operations" : ""}${mobileListOpen ? "" : " is-sidebar-collapsed"}${drawerOpen ? " has-drawer" : ""}${intelligenceSection === "reports" ? " is-reports" : ""} ws-${intelligenceSection}`} data-playback={playbackOverlay.active ? "true" : "false"}>
      {operationsMode ? <div className="forth-operations-header">
        <Link href="/dashboard" className="forth-operations-brand" title={language === "th" ? "กลับไปแดชบอร์ด" : "Return to dashboard"}>EES <span>{language === "th" ? "พื้นที่ปฏิบัติการกองรถ" : "Fleet operations workspace"}</span></Link>
        <div className="forth-operations-header-actions">
          <LanguageSwitcher />
          <AccountMenu />
          <button type="button" onClick={() => setOperationsMode(false)} title={language === "th" ? "แสดงแถบนำทาง EES" : "Show EES navigation"}>{language === "th" ? "แถบแอป" : "App bar"}</button>
        </div>
      </div> : null}
      {showMapShell ? (
      <div className="forth-tracking-grid">
        <button type="button" className="forth-mobile-map-collapse" aria-expanded={!mapCollapsed} onClick={() => setMapCollapsed(value => !value)}>{language === "th" ? (mapCollapsed ? "แสดงแผนที่" : "ย่อแผนที่") : (mapCollapsed ? "Show map" : "Collapse map")}</button>
        <section className={`forth-map-panel${mapCollapsed ? " is-map-collapsed" : ""}`} aria-label={copy.mapRegionLabel}>
          <ForthTrackingMap
            records={(connected || hasFleetSnapshot) && vehiclesLayerOn ? mapRecords : EMPTY_MAP_RECORDS}
            selectedKey={selectedKey}
            confirmedDriverFor={mapConfirmedDriverFor}
            emphasizedKeys={emphasizedKeys}
            onSelect={selectVisibleMapVehicle}
            onSharedLocation={(keys, kind) => {
              setSharedLocationKeys(keys);
              setSharedLocationKind(kind ?? "reported_position");
              setSharedLocationQuery("");
              setMoreOpen(false);
            }}
            command={mapCommand}
            filterKey={filter}
            onViewportKeys={publishVisibleMapKeys}
            onMarkerCoverage={setMarkerCoverage}
            announceEmpty={(connected || hasFleetSnapshot) && !loading && mapInitialFrame.allPositions.length === 0 && !forthGpsLocations.length}
            language={language}
            copy={mapCopy}
            directoryLocations={mapDirectoryLocations}
            forthGpsLocations={mapForthGpsLocations}
            locationsVisible={mapForthLocationsVisible}
            vehiclesVisible={vehiclesLayerOn && !playbackOverlay.active}
            selectedLocationId={selectedLocationId}
            onSelectLocation={(id) => {
              setSelectedKey(null);
              setInspectorOpen(false);
              setMobileInspectorOpen(false);
              setSelectedLocationId(id);
              setLocationsPanelOpen(true);
              setWorkspaceMode("locations");
              setMobileListOpen(true);
              // Do not enable the full 466-pin layer — focus the chosen destination only.
              const location = forthGpsLocations.find((entry) => entry.id === id);
              if (location) {
                setCameraMode("selected");
                setMapCommand((current) => ({
                  type: "focus_location",
                  sequence: current.sequence + 1,
                  location: { latitude: location.latitude, longitude: location.longitude }
                }));
              }
            }}
            playback={playbackOverlay.active ? playbackOverlay : null}
            onSelectPlaybackPoint={(index) => setPlaybackCursorOverride(index)}
          />
        </section>

        {headerNode}


        <aside id="forth-operations-sidebar" className="forth-operations-sidebar" aria-label={language === "th" ? "แถบปฏิบัติการกองรถ" : "Fleet operations sidebar"} hidden={!mobileListOpen}>
          <div className="forth-operations-heading v7-side-heading">
            <div>
              <h2>{language === "th" ? "รถ" : "Vehicles"}</h2>
              <p className="v7-side-count" aria-live="polite"><strong>{visibleRecords.length}</strong><span>/{summary.total}</span></p>
            </div>
            <button type="button" onClick={() => setMobileListOpen(false)} aria-label={language === "th" ? "ย่อรายการรถ" : "Collapse vehicle list"} title={language === "th" ? "ย่อรายการรถ" : "Collapse vehicle list"}><X className="h-4 w-4" /></button>
          </div>
          {intelligenceSection === "daily" || intelligenceSection === "fuel" ? <section className="forth-intelligence-summary">
            <p>{language === "th" ? "เลือกรถ แล้วเปิดแท็บวันนี้ เส้นทาง งาน หรือเชื้อเพลิง สรุปรายวันของกองรถอยู่ในรายงาน" : "Pick a vehicle, then use its Today, Journeys, Jobs or Fuel tab. Fleet daily summaries are under Reports."}</p>
          </section> : null}

          <nav className="forth-operations-modes" aria-label={language === "th" ? "เครื่องมือแผนที่" : "Map tools"}>
            {([
              ["overview", language === "th" ? "รายการรถ" : "Vehicles"],
              ["locations", language === "th" ? "ค้นหาสถานที่ / ชั้นแผนที่" : "Location search / layers"],
              ["playback", language === "th" ? "ย้อนเส้นทาง" : "Route playback"]
            ] as const).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                aria-pressed={workspaceMode === mode || (mode === "overview" && workspaceMode === "vehicle")}
                onClick={() => {
                  if (mode === "playback") {
                    enterPlayback();
                    return;
                  }
                  if (playbackOverlay.active || workspaceMode === "playback") {
                    exitPlayback(mode);
                    if (mode === "locations") setLocationsPanelOpen(true);
                    if (mode === "overview") {
                      setSelectedKey(null);
                      setSelectedLocationId(null);
                    }
                    return;
                  }
                  setWorkspaceMode(mode);
                  setSpeedWatchOpen(false);
                  if (mode === "locations") setLocationsPanelOpen(true);
                  if (mode === "overview") {
                    setSelectedKey(null);
                    setSelectedLocationId(null);
                  }
                }}
              >
                {label}
              </button>
            ))}
          </nav>
          {!connected && hasFleetSnapshot ? <p className="forth-snapshot-warning" role="status">{language === "th" ? "ข้อมูลเก่า — การเชื่อมต่อขาดหาย แสดงตำแหน่งจากการอัปเดตที่สำเร็จล่าสุด" : "Stale snapshot — connection unavailable. Positions are from the last successful refresh."} {lastChecked}</p> : null}
          {speedWatchOpen ? <div className="forth-speed-watch-panel" role="dialog" aria-label={language === "th" ? "สรุปความเร็ว" : "Speed Watch"}>
            <ForthSpeedWatch records={fleetRecords} available={connected || hasFleetSnapshot} language={language} forceOpen
              onClose={closeSpeedWatch} onSelect={selectVehicle} onFocusMap={(key) => selectVehicle(key, { focusMap: true })}
              confirmedDriverFor={(record) => confirmedAssignedDriver(record, eesVehicles)} />
          </div> : null}
          <div className="forth-operations-pane" hidden={intelligenceSection === "reports" || (workspaceMode !== "overview" && workspaceMode !== "vehicle")}>
        <section ref={mobileListDialogRef} id="forth-vehicle-list" className="forth-roster" aria-labelledby="forth-vehicle-list-title">
          <h2 id="forth-vehicle-list-title" className="sr-only">{language === "th" ? "เลือกรถเพื่อดูรายละเอียด" : "Select a vehicle for details"}</h2>
          <div className="forth-monitor-sticky">
          <div className="forth-vehicle-controls">
            <div className="forth-monitor-search-row">
              <label className="forth-monitor-search relative block">
                <span className="sr-only">{copy.search}</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  ref={mobileListSearchRef}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={language === "th" ? "ค้นหาทะเบียน ผู้ขับ หรือรุ่นรถ…" : "Search registration or driver…"}
                  type="search"
                  className="forth-monitor-search-input"
                />
              </label>
              <button type="button" className={`v7-filters-toggle${activeFilterCount ? " has-active" : ""}`} aria-expanded={filtersOpen} aria-controls="forth-v7-filters" onClick={() => setFiltersOpen((open) => !open)} title={language === "th" ? "ตัวกรองและการเรียง" : "Filters and sorting"}>
                <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">{language === "th" ? "ตัวกรอง" : "Filters"}</span>
                {activeFilterCount ? <strong aria-label={`${activeFilterCount} active`}>{activeFilterCount}</strong> : null}
              </button>
            </div>
            <div id="forth-v7-filters" className="v7-filters" hidden={!filtersOpen}>
            <label className="forth-monitor-sort-wrap">
              <span>{copy.sort}</span>
              <select id="forth-fleet-sort" aria-label={copy.sort} value={sort} onChange={(event) => setSort(event.target.value as ForthFleetSort)} className="forth-monitor-select">
                <option value="operations">{copy.sortOperations}</option>
                <option value="registration">{copy.sortRegistration}</option>
                <option value="speed_desc">{copy.sortSpeed}</option>
                <option value="updated_desc">{copy.sortUpdated}</option>
                <option value="status">{copy.sortStatus}</option>
              </select>
            </label>
            <label className="fleet-category-filter"><span>{language === "th" ? "ประเภทรถ" : "Vehicle category"}</span><select value={vehicleCategory} onChange={event => setVehicleCategory(event.target.value)}><option value="all">{language === "th" ? "ทุกประเภท" : "All categories"}</option>{[...new Set(fleetRecords.map(record => getForthTrackingVehicleIdentity(record.vehicleRegistration).vehicleClass))].sort().map(category => <option value={category} key={category}>{vehicleCategoryLabel(category, language) || (language === "th" ? "ไม่ทราบประเภท" : "Unknown category")}</option>)}</select></label>
            <label className="forth-monitor-more-filter">
              <span>{copy.filter}</span>
              <select id="forth-fleet-filter" aria-label={copy.filter} value={filter} onChange={(event) => applyFleetFilter(event.target.value as ForthFleetFilter)} className="forth-monitor-select">
                <option value="all">{copy.all}</option>
                <option value="online">{copy.filterOnline}</option>
                <optgroup label={copy.activityGroup}>
                  <option value="driving">{copy.drivingFilter}</option>
                  <option value="uncertain">{copy.filterUncertain}</option>
                  <option value="stopped">{copy.stoppedFilter}</option>
                  <option value="unavailable">{copy.unknown}</option>
                </optgroup>
                <optgroup label={copy.attentionGroup}>
                  <option value="attention">{copy.filterAttention}</option>
                  <option value="offline">{copy.filterOffline}</option>
                  <option value="stale">{copy.filterStale}</option>
                  <option value="verified">{copy.filterVerified}</option>
                  <option value="unverified">{copy.filterUnverified}</option>
                  <option value="engine_on_stopped">{copy.filterEngineOnStopped}</option>
                  <option value="high_speed">{copy.speedReview}</option>
                  <option value="missing_coordinates">{copy.attentionMissing}</option>
                </optgroup>
              </select>
            </label>
            </div>
            {(filter === "driving" && (connected || hasFleetSnapshot) && drivingMapRecords.length > 0) || search.trim() || filter !== "all" || vehicleCategory !== "all" ? (
              <div className="forth-monitor-toolbar">
                {filter === "driving" && (connected || hasFleetSnapshot) && drivingMapRecords.length > 0 ? (
                  <button type="button" className="forth-monitor-map-action" title={copy.showDrivingOnMap} aria-pressed={mapDisplayFilter === "driving"} onClick={showDrivingOnMap}>
                    <MapPinned className="h-3.5 w-3.5" aria-hidden="true" />
                    {language === "th" ? "แผนที่" : "On map"}
                    <strong>{drivingMapRecords.length}</strong>
                  </button>
                ) : null}
                {search.trim() || filter !== "all" || vehicleCategory !== "all" ? (
                  <button type="button" className="forth-monitor-clear" onClick={() => { setSearch(""); setVehicleCategory("all"); applyFleetFilter("all"); }}>{copy.clearFilters}</button>
                ) : null}
              </div>
            ) : null}
          </div>
          </div>
          <div className="forth-vehicle-results">
            {connected && fleetRecords.length === 0 ? <div className="forth-roster-empty">{copy.noVehicles}</div> : null}
            {connected && fleetRecords.length > 0 && visibleRecords.length === 0 ? <div className="forth-roster-empty">{copy.noMatches}</div> : null}
            {connected || hasFleetSnapshot ? visibleRecords.map((record) => {
              const key = recordKeysByReference.get(record);
              const confirmedDriver = confirmedAssignedDriver(record, eesVehicles);
              return key ? <FleetVehicleRow key={key} record={record} recordKey={key} active={key === selectedKey} copy={copy} language={language} confirmedDriver={confirmedDriver} display={{ ...monitorDisplay, speed: true, driver: true, location: true, gpsConfidence: true, reportAge: true }} rowRef={key === selectedKey ? (node) => { selectedRowRef.current = node; } : undefined} onSelect={(next) => selectVehicle(next)} /> : null;
            }) : null}
            {!connected && !loading && !requestError && data?.connectionStatus !== "not_configured" ? <div className="forth-roster-empty">{copy.failureBody}</div> : null}
            {loading && !data ? <div className="forth-roster-empty">{copy.mapLoading}</div> : null}
          </div>
        </section>
            <details className="forth-depot-disclosure"><summary>{language === "th" ? "ลานจอด / สำนักงาน EES" : "Depot & office"}</summary><EesDepotOperationsPanel records={fleetRecords} fetchedAt={data?.fetchedAt ?? null} loading={loading} snapshotStale={!connected} onSelect={selectVehicle} confirmedDriverFor={mapConfirmedDriverFor} /></details>

          </div>
          <div className="forth-operations-pane" hidden={workspaceMode !== "vehicle"}>
            <button type="button" className="forth-back-to-fleet" onClick={() => { setWorkspaceMode("overview"); setInspectorOpen(false); setMobileInspectorOpen(false); }}>{language === "th" ? "← กลับกองรถ" : "← Back to Fleet"}</button>
            {!selectedRecord ? (
              <div className="forth-operations-empty">
                <h3>{language === "th" ? "เลือกรถ" : "Choose a vehicle"}</h3>
                <p>{language === "th" ? "ค้นหาทะเบียนหรือเลือกจากภาพรวม/แผนที่" : "Search by registration or pick from Fleet Overview / the map."}</p>
                <label className="forth-focus-vehicle-picker">
                  <span className="sr-only">{language === "th" ? "ค้นหารถ" : "Search vehicles"}</span>
                  <input
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={language === "th" ? "ค้นหาทะเบียน…" : "Search registration…"}
                  />
                </label>
                <ul className="forth-focus-vehicle-list">
                  {visibleRecords.slice(0, 12).map((record) => {
                    const key = recordKeysByReference.get(record);
                    if (!key) return null;
                    const identity = getForthTrackingVehicleIdentity(record.vehicleRegistration);
                    return (
                      <li key={key}>
                        <button type="button" onClick={() => selectVehicle(key)}>
                          <strong>{record.vehicleRegistration || "—"}</strong>
                          <span>{vehicleCategoryLabel(identity.vehicleClass, language)}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <button type="button" className="btn-secondary" onClick={() => setWorkspaceMode("overview")}>{language === "th" ? "ดูรถทั้งหมด" : "Browse vehicles"}</button>
              </div>
            ) : null}


          </div>
          <div className="forth-operations-pane" hidden={workspaceMode !== "locations"}>
            <details className="forth-layers-disclosure">
              <summary>{language === "th" ? "ชั้นแผนที่" : "Layers"}<span>{locationsLayerOn ? (language === "th" ? "หมุดลูกค้าเปิด" : "Customer pins on") : (language === "th" ? "หมุดลูกค้าปิด" : "Customer pins off")}</span></summary>
            <div className="forth-location-layer-controls" role="group" aria-label={language === "th" ? "ชั้นแผนที่" : "Map layers"}>
              <label className={`forth-layer-toggle${vehiclesLayerOn ? " is-on" : ""}`}>
                <span className="forth-layer-toggle-copy">
                  <strong>{language === "th" ? "รถกอง" : "Fleet vehicles"}</strong>
                  <small>{language === "th" ? "หมุดรถบนแผนที่" : "Live vehicle markers"}</small>
                </span>
                <input type="checkbox" checked={vehiclesLayerOn} onChange={(event) => setVehiclesLayerOn(event.target.checked)} />
              </label>
              <label className={`forth-layer-toggle${locationsLayerOn ? " is-on" : ""}`}>
                <span className="forth-layer-toggle-copy">
                  <strong>{language === "th" ? "หมุดลูกค้า Forth ทั้งหมด" : "All Forth customer pins"}</strong>
                  <small>{language === "th" ? "466 จุด · ปิดตามค่าเริ่มต้น" : "466 destinations · off by default"}</small>
                </span>
                <input type="checkbox" checked={locationsLayerOn} onChange={(event) => setLocationsLayerOn(event.target.checked)} />
              </label>
              <label className={`forth-layer-toggle${depotOfficeLayerOn && !locationsLayerOn ? " is-on" : ""}${locationsLayerOn ? " is-disabled" : ""}`}>
                <span className="forth-layer-toggle-copy">
                  <strong>{language === "th" ? "คลัง / สำนักงาน EES" : "EES depot / office"}</strong>
                  <small>{locationsLayerOn ? (language === "th" ? "รวมอยู่ในหมุดลูกค้า" : "Included when customer pins are on") : (language === "th" ? "แสดงเฉพาะคลังและสำนักงาน" : "Depot and office markers only")}</small>
                </span>
                <input type="checkbox" checked={depotOfficeLayerOn} onChange={(event) => setDepotOfficeLayerOn(event.target.checked)} disabled={locationsLayerOn} />
              </label>
            </div>
            </details>
            <details className="forth-visits-context"><summary>{language === "th" ? "ขอบเขตเหตุการณ์ (ปิดอยู่)" : "Event boundaries (off)"}</summary><p>{language === "th" ? "466 จุด Forth ใช้ดูและค้นหาเท่านั้น — ไม่เปิด geofence / ไม่สร้างการมาถึง / ไม่ส่งการแจ้งเตือนอัตโนมัติ" : "All 466 Forth pins are for map display and search only — geofences, arrivals and automatic notifications stay off."}</p><Link href="/fleet-events">{language === "th" ? "ดูเหตุการณ์ที่มีอยู่" : "View existing location events"}</Link></details>
            {selectedDirectoryLocation ? <div className="forth-office-location-card"><span>{language === "th" ? "หมุด Directory ที่สำนักงานยืนยัน" : "Office-confirmed Directory pin"}</span><h3>{selectedDirectoryLocation.companyName}</h3><p>{selectedDirectoryLocation.address}</p><button type="button" onClick={() => setMapCommand((current) => ({ type: "focus_location", sequence: current.sequence + 1, location: selectedDirectoryLocation }))}>{language === "th" ? "โฟกัสแผนที่" : "Focus on map"}</button></div> : null}
        {locationsPanelOpen ? (
          <div className="forth-locations-slot">
            <p className="forth-locations-state" data-state={forthGpsLoadState} data-layer={locationsLayerOn ? "visible" : selectedLocationId ? "focus" : "hidden"} role="status">
              {forthGpsLoadState === "unauthorized" ? (language === "th" ? "บัญชีนี้ไม่มีสิทธิ์อ่านสถานที่ Forth" : "This account cannot read Forth saved locations.")
              : forthGpsLoadState === "failed" ? (language === "th" ? "โหลดสถานที่ Forth ไม่สำเร็จ" : "Forth saved locations could not be loaded.")
              : forthGpsLoadState === "invalid_source" ? (language === "th" ? "ไฟล์ Forth CSV ไม่ผ่านการตรวจสอบ" : "Forth CSV source failed validation.")
              : forthGpsLoadState === "loading" ? (language === "th" ? "กำลังโหลดสถานที่ Forth" : "Loading Forth locations")
              : locationsLayerOn
                ? (language === "th"
                  ? `${FORTH_GPS_SOURCE_LABEL} · แสดงทั้ง ${forthGpsLocations.length} จุด · Directory ${directoryLocationCount} คงเดิม`
                  : `${FORTH_GPS_SOURCE_LABEL} · showing all ${forthGpsLocations.length} · Directory ${directoryLocationCount} preserved`)
                : selectedLocationId
                  ? (language === "th" ? "แสดงเฉพาะจุดที่เลือก · ชั้นหมุดทั้งหมดยังปิด" : "Showing selected destination only · full pin layer still off")
                  : (language === "th" ? "ชั้นหมุดลูกค้าปิด — ค้นหาได้ทั้งหมด 466 จุด" : "Customer pin layer off — all 466 remain searchable")}
            </p>
            {forthGpsLoadState === "failed" || forthGpsLoadState === "invalid_source" ? <button type="button" className="forth-locations-retry" onClick={() => setLocationsReload((value) => value + 1)}>{language === "th" ? "ลองโหลดสถานที่อีกครั้ง" : "Retry locations"}</button> : null}
            <ForthGpsLocationsPanel
              locations={forthGpsLocations}
              groups={forthGpsGroups}
              records={fleetRecords}
              available={forthGpsLoadState === "ready"}
              language={language}
              selectedId={selectedLocationId}
              directoryCount={directoryLocationCount}
              onSelect={(id) => {
                setSelectedKey(null);
                setInspectorOpen(false);
                setMobileInspectorOpen(false);
                setSelectedLocationId(id);
                setWorkspaceMode("locations");
                const location = forthGpsLocations.find((entry) => entry.id === id);
                if (location) {
                  setCameraMode("selected");
                  setMapCommand((current) => ({ type: "focus_location", sequence: current.sequence + 1, location }));
                }
              }}
              onFocusMap={(id) => {
                const location = forthGpsLocations.find((entry) => entry.id === id);
                if (!location) return;
                setSelectedKey(null);
                setSelectedLocationId(id);
                setWorkspaceMode("locations");
                setCameraMode("selected");
                setMapCommand((current) => ({
                  type: "focus_location",
                  sequence: current.sequence + 1,
                  location: { latitude: location.latitude, longitude: location.longitude }
                }));
              }}
              onFitResults={(ids) => {
                const points = forthGpsLocations
                  .filter((location) => ids.includes(location.id))
                  .map((location) => ({ latitude: location.latitude, longitude: location.longitude }));
                if (!points.length) return;
                // Fitting many results needs the layer on; a single result can stay focus-only.
                if (points.length > 1) setLocationsLayerOn(true);
                else if (ids[0]) setSelectedLocationId(ids[0]);
                setMapCommand((current) => ({
                  type: "fit_locations",
                  sequence: current.sequence + 1,
                  locations: points
                }));
              }}
              onSelectVehicle={(key, options) => selectVehicle(key, options)}
              confirmedDriverFor={(record) => confirmedAssignedDriver(record, eesVehicles)}
              onClose={() => {
                showFleetOverview();
              }}
            />
          </div>
        ) : null}

          </div>
          <div className="forth-operations-pane" hidden={workspaceMode !== "playback"}>
            <ForthJourneyPlaybackPanel
              ref={playbackPanelRef}
              language={language}
              records={fleetRecords}
              selectedKey={selectedKey}
              onSelectVehicle={(key) => {
                setSelectedKey(key);
                setWorkspaceMode("playback");
                setInspectorOpen(false);
                setMobileInspectorOpen(false);
              }}
              forthGpsLocations={forthGpsLocations}
              selectedLocationId={selectedLocationId}
              externalCursorIndex={playbackCursorOverride}
              onExternalCursorConsumed={() => setPlaybackCursorOverride(null)}
              onPlaybackChange={(state) => {
                setPlaybackOverlay((current) => {
                  if (
                    current.active === state.active &&
                    current.cursorIndex === state.cursorIndex &&
                    current.registration === state.registration &&
                    current.points === state.points &&
                    current.segments === state.segments &&
                    current.reportedTrailSegments === state.reportedTrailSegments
                  ) {
                    return current;
                  }
                  return state;
                });
                if (!state.active) setPlaybackCursorOverride(null);
              }}
              onExitToLive={routeMapOpen ? leaveRouteMap : () => exitPlayback("overview")}
              presetRange={routeRange}
            />
          </div>
        </aside>

        {selectedRecord && workspaceMode === "vehicle" && inspectorOpen ? (
          <section className="forth-vehicle-card fleet-details-drawer" aria-labelledby="forth-vehicle-details-title">
            <div className="forth-vehicle-card-header v7-vehicle-header">
              <div className="min-w-0">
                <h2 id="forth-vehicle-details-title" className="v7-vehicle-reg">{selectedRecord.vehicleRegistration || copy.unknownValue}</h2>
                <p className="forth-inspector-identity truncate">
                  {[vehicleCategoryLabel(getForthTrackingVehicleIdentity(selectedRecord.vehicleRegistration).vehicleClass, language), getForthTrackingVehicleIdentity(selectedRecord.vehicleRegistration).make, getForthTrackingVehicleIdentity(selectedRecord.vehicleRegistration).model].filter(Boolean).join(" · ")}
                </p>
                {selectedConfirmedDriver ? <p className="forth-inspector-driver truncate"><span>{copy.confirmedDriverLabel}</span> {selectedConfirmedDriver}</p> : null}
                {!selectedConfirmedDriver && selectedRecord.reportedDriver ? <p className="forth-inspector-driver is-unverified truncate">{copy.forthDriverUnverified}: {selectedRecord.reportedDriver}</p> : null}
                {!selectedConfirmedDriver && !selectedRecord.reportedDriver ? <p className="forth-inspector-driver is-unverified">{language === "th" ? "ยังไม่ยืนยันผู้ขับ" : "Driver not confirmed"}</p> : null}
                {selectedConfirmedDriver && selectedRecord.reportedDriver && selectedRecord.reportedDriver !== selectedConfirmedDriver ? <p className="forth-inspector-driver is-unverified truncate">{copy.forthDriverUnverified}: {selectedRecord.reportedDriver}</p> : null}
              </div>
              <div className="v7-vehicle-header-actions">
                {selectedHasMapPosition ? <button type="button" onClick={focusSelectedOnMap} aria-label={copy.focusOnMap} title={copy.focusOnMap} className="v7-icon-button"><MapPinned className="h-4 w-4" /></button> : null}
                <button ref={vehicleDetailsCloseRef} type="button" aria-label={copy.mapCloseInspector} title={copy.mapCloseInspector} onClick={showFleetOverview} className="v7-icon-button"><X className="h-4 w-4" /></button>
              </div>
            </div>
            <div className="v7-vehicle-status" data-gps={isForthGpsPositionVerified(selectedRecord) ? "verified" : "unverified"} role="group" aria-label={language === "th" ? "สถานะปัจจุบัน" : "Current status"}>
              <ActivityPill activity={getForthReportedActivity(selectedRecord)} copy={copy} compact />
              <span className={`v7-chip ${isForthGpsPositionVerified(selectedRecord) ? "is-verified" : "is-unverified"}`}>{isForthGpsPositionVerified(selectedRecord) ? (language === "th" ? "GPS ยืนยัน" : "GPS verified") : (language === "th" ? "GPS ไม่ยืนยัน" : "GPS unverified")}</span>
              <span className="v7-chip">{selectedRecord.speed === null ? "—" : selectedRecord.speed} km/h</span>
              <span className="v7-chip" title={selectedExactPositionTime ?? undefined}>{selectedPositionAge ?? timestampStatusLabel(selectedRecord, copy)}</span>
            </div>
            <div className="v71-drawer-actions" role="group" aria-label={language === "th" ? "เปิดมุมมองของรถคันนี้" : "Open this vehicle in a workspace"}>
              <button type="button" onClick={() => goWorkspace("daily")}>{language === "th" ? "ดูกิจกรรม" : "View activity"}</button>
              <button type="button" onClick={() => goWorkspace("journeys")}>{language === "th" ? "ดูเส้นทาง" : "View journeys"}</button>
              <button type="button" onClick={() => goWorkspace("fuel")}>{language === "th" ? "ดูเชื้อเพลิง" : "View fuel"}</button>
              <button type="button" aria-expanded={detailSection === "health"} onClick={() => setDetailSection((current) => current === "health" ? "overview" : "health")}>{language === "th" ? "สถานะ GPS" : "GPS health"}</button>
            </div>
            {detailSection === "health" ? <section className="v71-drawer-health" aria-label={language === "th" ? "สถานะ GPS" : "GPS health"}>{gpsHealthNode}</section> : null}


            <div className="forth-vehicle-card-body">
              {selectedGpsHealth ? <div className="forth-inspector-gps-health" data-health={selectedGpsHealth.letter} data-verified={selectedGpsHealth.verified ? "true" : "false"} role="status"><strong>{selectedGpsHealth.line}</strong><details><summary>{language === "th" ? "รายละเอียด" : "Details"}</summary><span>{selectedGpsHealth.reason}</span></details></div> : null}
              {selectedLiveStatus && selectedLiveStatus.statements.length ? <ul className="forth-live-statements" data-live-statements aria-label={language === "th" ? "สถานะสดของรถ" : "Live vehicle status"}>{selectedLiveStatus.statements.map(statement => <li key={statement.id} data-tone={statement.tone} data-statement={statement.id}>{liveStatementLabel(statement.id, language)}</li>)}</ul> : null}
              <div className="forth-inspector-grid" aria-label={copy.activityGroup}>
                <p><span>{copy.engine}</span><strong className={selectedRecord.engineOn === true ? "text-amber-900" : selectedRecord.engineOn === false ? "text-indigo-800" : ""}>{selectedRecord.engineOn === null ? copy.unknownValue : selectedRecord.engineOn ? copy.engineOnLabel : copy.engineOffLabel}</strong></p>
                <p><span>{copy.trackerStatus}</span><strong><ConnectivityValue connected={selectedRecord.gprsConnectivity} copy={copy} /></strong></p>
                <p><span>{language === "th" ? "ตำแหน่ง GPS" : "GPS position"}</span><strong className={isForthGpsPositionVerified(selectedRecord) ? "text-emerald-800" : "text-amber-900"}>{isForthGpsPositionVerified(selectedRecord) ? copy.gpsPositionVerified : (language === "th" ? "ยังไม่ยืนยัน GPS" : "GPS not verified")}</strong></p>
              </div>
              {getForthReportedActivity(selectedRecord) === "uncertain" ? <p className="mt-2 text-xs leading-5 text-orange-950">{copy.activityConflictNote}</p> : null}
              {(() => {
                const speedReview = evaluateForthSpeedReview(selectedRecord);
                if (!speedReview) return null;
                if (!speedReview.isReview && speedReview.config) {
                  return (
                    <div className="forth-inspector-speed-context" title={language === "th" ? speedReview.reasonTh : speedReview.reasonEn}>
                      <span>{copy.speedAdvisoryLabel} {speedReview.applicableLimitKmh} km/h · {copy.speedDelayLabel} {speedReview.alertDelaySeconds}s</span>
                      <strong>{forthSpeedEvidenceLabel(speedReview.evidenceKind, language)}</strong>
                    </div>
                  );
                }
                if (!speedReview.isReview) {
                  return selectedRecord.speed !== null ? (
                    <p className="forth-inspector-speed-context" title={copy.speedReviewNote}>
                      <span>{copy.speedLimitUnavailable}</span>
                      <strong>{forthSpeedReviewConfidenceLabel(speedReview.confidence, language)}</strong>
                    </p>
                  ) : null;
                }
                return (
                  <div className={`forth-inspector-speed-review${speedReview.isConfirmedDeviceOverspeed ? " is-confirmed" : ""}`} title={language === "th" ? speedReview.reasonTh : speedReview.reasonEn}>
                    <p><strong>{copy.speedReview}</strong> · {forthSpeedEvidenceLabel(speedReview.evidenceKind, language)}</p>
                    <p>
                      <span>{copy.speedAdvisoryLabel} {speedReview.applicableLimitKmh} km/h</span>
                      {speedReview.alertDelaySeconds != null ? <span> · {copy.speedDelayLabel} {speedReview.alertDelaySeconds}s</span> : null}
                      {speedReview.overLimitKmh !== null ? <span> · {copy.speedOverAdvisory} {speedReview.overLimitKmh >= 0 ? "+" : ""}{speedReview.overLimitKmh}</span> : null}
                    </p>
                    <p className="forth-inspector-speed-review-note">{copy.speedReviewNote}</p>
                  </div>
                );
              })()}
              <div className="forth-inspector-position">
                <p className="forth-inspector-location">{selectedLocationDescription ?? copy.locationUnavailable}</p>
                {!selectedHasMapPosition ? <p className="forth-inspector-focus-unavailable" role="status">{language === "th" ? "ไม่สามารถโฟกัสบนแผนที่: Forth ไม่มีพิกัดที่ใช้งานได้สำหรับรถคันนี้" : "Map focus unavailable: Forth has no usable coordinates for this vehicle."}</p> : null}
                <p className="forth-inspector-timing">
                  <strong>{selectedExactPositionTime ? `${copy.exactPositionTime}: ${selectedExactPositionTime}` : timestampStatusLabel(selectedRecord, copy)}</strong>
                  {selectedPositionAge ? <span> · {copy.reportAge}: {selectedPositionAge}</span> : null}
                </p>
                {selectedNearbyLocations.length ? (
                  <div className="forth-inspector-nearby-locations" aria-label={language === "th" ? "สถานที่บันทึกที่ใกล้ที่สุด" : "Nearest saved locations"}>
                    <span className="forth-inspector-section-label">{language === "th" ? "สถานที่บันทึกใกล้เคียง (ข้อมูลเท่านั้น — ไม่ใช่งานจัดส่ง)" : "Nearest saved locations (informational — not an assigned delivery)"}</span>
                    {selectedNearbyLocations.map(({ location, distanceKm }) => (
                      <button
                        key={location.id}
                        type="button"
                        className="forth-inspector-nearby-row"
                        onClick={() => {
                          setSelectedKey(null);
                          setSelectedLocationId(location.id);
                          setLocationsPanelOpen(true); setWorkspaceMode("locations"); setMobileListOpen(true);
                          setMapCommand((current) => ({
                            type: "focus_location",
                            sequence: current.sequence + 1,
                            location: { latitude: location.latitude, longitude: location.longitude }
                          }));
                        }}
                      >
                        <strong>{location.companyName}</strong>
                        <span>{distanceKm < 10 ? `${distanceKm.toFixed(1)} km` : `${Math.round(distanceKm)} km`}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
            {selectedHasMapPosition || (selectedEesVehicle && can("business:read")) ? (
              <details className="forth-inspector-more-actions">
                <summary>{language === "th" ? "การดำเนินการเพิ่มเติม" : "More actions"}</summary>
                <div className="forth-inspector-more-action-list">
                  {selectedHasMapPosition ? <button type="button" onClick={() => void copySelectedCoordinates()} className="btn-secondary min-h-9 justify-center gap-1.5 px-2 text-xs" title={language === "th" ? "คัดลอกพิกัดที่ Forth รายงาน" : "Copy Forth-reported coordinates"}><Copy className="h-4 w-4" />{language === "th" ? "คัดลอกพิกัด" : "Copy coords"}</button> : null}
                  {selectedHasMapPosition ? <button type="button" onClick={openSelectedCoordinatesExternally} className="btn-secondary min-h-9 justify-center gap-1.5 px-2 text-xs" title={isForthGpsPositionVerified(selectedRecord) ? (language === "th" ? "เปิดพิกัดบนแผนที่ภายนอก" : "Open reported coordinates externally") : (language === "th" ? "พิกัดยังไม่ยืนยัน GPS — ใช้ด้วยความระมัดระวัง" : "GPS not verified — use with caution")}><ExternalLink className="h-4 w-4" />{language === "th" ? "แผนที่ภายนอก" : "External map"}</button> : null}
                </div>
                {selectedEesVehicle && can("business:read") ? (
                  <div className="forth-inspector-ees-links" aria-label={language === "th" ? "บันทึก EES ที่เกี่ยวข้อง" : "Related EES records"}>
                    <Link href={`/maintenance/analytics?vehicle=${encodeURIComponent(selectedEesVehicle.id)}`} className="btn-secondary min-h-9 justify-center px-2 text-xs">{language === "th" ? "บำรุงรักษา" : "Maintenance"}</Link>
                    <Link href="/vehicle-performance" className="btn-secondary min-h-9 justify-center px-2 text-xs">{language === "th" ? "ประสิทธิภาพรถ" : "Vehicle performance"}</Link>
                    <Link href="/booking-diary" className="btn-secondary min-h-9 justify-center px-2 text-xs">{language === "th" ? "สมุดจอง" : "Booking diary"}</Link>
                  </div>
                ) : null}
              </details>
            ) : null}
            {coordinateActionNote ? <p className="forth-inspector-action-note" role="status">{coordinateActionNote}</p> : null}
            {selectedHasMapPosition && !isForthGpsPositionVerified(selectedRecord) ? <p className="forth-inspector-dispatch-caution">{language === "th" ? "พิกัดนี้ยังไม่ยืนยันด้วย GPS — ไม่ควรใช้ตัดสินใจจัดส่งโดยลำพัง" : "These coordinates are not GPS-verified — do not use alone for dispatch decisions."}</p> : null}
          </section>
        ) : null}

        <div className="forth-overlay-stage">
          {playbackOverlay.active || workspaceMode === "playback" ? (
          <button type="button" className="forth-playback-map-exit" onClick={routeMapOpen ? leaveRouteMap : () => exitPlayback("overview")}>
            {routeMapOpen ? (language === "th" ? "กลับไปเส้นทางและงาน" : "Back to Journeys & Jobs") : (language === "th" ? "กลับกองรถสด" : "Back to Live Fleet")}
          </button>
        ) : null}
        {(connected || hasFleetSnapshot) ? <div className="forth-map-status">
          <div className="forth-map-primary-actions" role="group" aria-label={language === "th" ? "การควบคุมแผนที่" : "Map controls"}>
            <button type="button" aria-pressed={cameraMode === "bangkok" && mapDisplayFilter === "all" && mapMode === "reported"} onClick={() => applyCameraMode("bangkok")}>{language === "th" ? "พื้นที่ปฏิบัติการ" : "Fit ops"}</button>
            <button type="button" aria-pressed={cameraMode === "full_fleet" && mapDisplayFilter === "all"} onClick={() => applyCameraMode("full_fleet")}>{language === "th" ? "ทั้งกอง" : "Fit fleet"}</button>
            <button type="button" aria-pressed={cameraMode === "selected"} disabled={!selectedHasMapPosition && !selectedLocationId} onClick={() => {
              if (selectedLocationId) {
                const location = forthGpsLocations.find((entry) => entry.id === selectedLocationId);
                if (!location) return;
                setCameraMode("selected");
                setMapCommand((current) => ({ type: "focus_location", sequence: current.sequence + 1, location }));
                return;
              }
              applyCameraMode("selected");
            }}>{language === "th" ? "โฟกัสที่เลือก" : "Focus selected"}</button>
            <details className="forth-map-layers">
              <summary>{language === "th" ? "เลเยอร์" : "Layers"}</summary>
              <div className="forth-map-mode" role="group" aria-label={language === "th" ? "ตัวเลือกแผนที่" : "Map options"}>
                <button type="button" aria-pressed={mapDisplayFilter === "driving" || cameraMode === "driving"} onClick={showDrivingOnMap} title={copy.movingHelper}>{language === "th" ? "แสดงรถที่กำลังขับ" : "Show driving"}<strong>{drivingMapRecords.length}</strong></button>
                <button type="button" aria-pressed={cameraMode === "gps_verified" || mapMode === "gps" || mapDisplayFilter === "gps_verified"} onClick={() => applyCameraMode("gps_verified")} title={language === "th" ? `ซ่อนที่ยังไม่ยืนยัน ${summary.positionConfidence.notGpsVerified} คัน` : `Hides ${summary.positionConfidence.notGpsVerified} unverified`}>{language === "th" ? "เฉพาะ GPS ที่ยืนยัน" : "GPS verified only"}<strong>{summary.currentGpsVerifiedPositions}</strong></button>
                <button type="button" aria-pressed={vehiclesLayerOn} onClick={() => setVehiclesLayerOn((value) => !value)}>{language === "th" ? "หมุดรถ" : "Vehicle markers"}</button>
                <button
                  type="button"
                  className="forth-map-locations-btn"
                  aria-pressed={locationsLayerOn}
                  title={language === "th" ? "เปิด/ปิดหมุดลูกค้า Forth ทั้งชุดบนแผนที่" : "Toggle all Forth customer pins on the map"}
                  onClick={() => {
                    setLocationsLayerOn((value) => !value);
                    setLocationsPanelOpen(true);
                    if (playbackOverlay.active || workspaceMode === "playback") {
                      exitPlayback("locations");
                    } else {
                      setWorkspaceMode("locations");
                      setSpeedWatchOpen(false);
                    }
                    setMobileListOpen(true);
                  }}
                >
                  {language === "th" ? "หมุดลูกค้า" : "Customer pins"}
                  <strong>{locationsLayerOn ? (forthGpsLoadState === "ready" ? forthGpsLocations.length : "—") : "off"}</strong>
                </button>
              </div>
            </details>

          </div>
          {mapMode === "gps" && liveMatrixInScope.hiddenByVerifiedOnly.total > 0 ? <span className="forth-map-hidden-note" data-hidden-unverified title={language === "th" ? `ซ่อนจากแผนที่เพราะยังไม่ยืนยัน GPS: ${liveMatrixInScope.hiddenByVerifiedOnly.withCoordinates} คันมีพิกัด, ${liveMatrixInScope.hiddenByVerifiedOnly.moving} คันรายงานว่าเคลื่อนที่` : `Hidden from the verified-only map: ${liveMatrixInScope.hiddenByVerifiedOnly.withCoordinates} have coordinates, ${liveMatrixInScope.hiddenByVerifiedOnly.moving} reported moving`}>{liveMatrixInScope.hiddenByVerifiedOnly.total} {language === "th" ? "ซ่อน (ยังไม่ยืนยัน)" : "hidden unverified"}{liveMatrixInScope.hiddenByVerifiedOnly.moving > 0 ? ` · ${liveMatrixInScope.hiddenByVerifiedOnly.moving} ${language === "th" ? "เคลื่อนที่" : "moving"}` : ""}</span> : null}
          {drivingOutsideRecords.length > 0 ? (
            <button
              type="button"
              className="forth-outside-button is-driving"
              aria-expanded={drivingOutsideOpen}
              onClick={() => { setDrivingOutsideOpen((open) => !open); setOutsideCoreOpen(false); setOffscreenOpen(false); }}
              title={language === "th" ? "รถที่รายงานว่ากำลังขับอยู่นอกมุมมองปัจจุบัน ยังอยู่ในรายการกองรถ" : "Reported driving vehicles outside the current view; still listed in Live Fleet"}
            >
              {drivingOutsideRecords.length} {copy.drivingOutsideArea}
            </button>
          ) : null}
          {outsideCore.outside.length > 0 && mapDisplayFilter !== "driving" ? (
            <button
              type="button"
              className="forth-outside-button"
              aria-expanded={outsideCoreOpen}
              onClick={() => setOutsideCoreOpen((open) => !open)}
              title={language === "th" ? "รถที่มีพิกัดนอกพื้นที่ปฏิบัติการหลัก ยังอยู่ในรายการกองรถ" : "Vehicles with coordinates outside Core Operations; still listed in Live Fleet"}
            >
              {outsideCore.outside.length} {language === "th" ? "นอกพื้นที่หลัก" : "outside core"}
            </button>
          ) : null}
          {offscreenMapRecords.length > 0 && mapDisplayFilter !== "driving" ? <button type="button" className="forth-outside-button" aria-expanded={offscreenOpen} aria-controls="forth-offscreen-vehicles" onClick={() => setOffscreenOpen((open) => !open)}>{offscreenMapRecords.length} {language === "th" ? "นอกมุมมอง" : "outside view"}</button> : null}
        </div> : null}
        {connected && markerCoverage ? (
          <div className={`forth-map-coverage-control${mapCoverageOpen ? " is-open" : ""}${unmappedPositionCount > 0 ? " has-coverage-issue" : ""}`}>
            <button
              type="button"
              className="forth-map-coverage-toggle"
              aria-expanded={mapCoverageOpen}
              aria-controls="forth-map-coverage-details"
              onClick={() => setMapCoverageOpen((open) => !open)}
              title={language === "th" ? "สถานะการแสดงผลบนแผนที่" : "Map coverage status"}
            >
              <MapPinned className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{language === "th" ? "สถานะแผนที่" : "Map status"}</span>
              {unmappedPositionCount > 0 ? <strong className="is-missing">{unmappedPositionCount}</strong> : null}
            </button>
            {mapCoverageOpen ? (
              <div id="forth-map-coverage-details" className="forth-position-legend" aria-label={copy.mapConfidence}>
                <span className="is-fleet" title={language === "th" ? "รถที่ Forth ส่งกลับ" : "Vehicles returned by Forth"}>{summary.total} {language === "th" ? "ที่ได้รับ" : "returned"}</span>
                <span className="is-coords" title={language === "th" ? "รถที่มีพิกัดในโหมดนี้" : "Vehicles with coordinates in this mode"}>{positionedMapRecords.length} {language === "th" ? "มีพิกัด" : "with coords"}</span>
                <span className="is-symbols" title={language === "th" ? "สัญลักษณ์ที่ติดตั้งบนแผนที่" : "Mounted map symbols"}>{markerCoverage.symbolCount} {language === "th" ? "สัญลักษณ์" : "symbols"}</span>
                <span className="is-coords" title={language === "th" ? "ทะเบียนที่อ่านได้ในมุมมองปัจจุบัน รวมทะเบียนที่เลือกในกลุ่ม" : "Individually readable registrations in the current viewport, including a selected grouped vehicle"}>{markerCoverage.readableRegistrationCount} {language === "th" ? "ทะเบียนที่อ่านได้" : "readable labels"}</span>
                <span className="is-coords" title={language === "th" ? "รถที่มีสัญลักษณ์บนแผนที่ / รถที่มีพิกัดในโหมดนี้" : "Vehicles represented by map symbols / vehicles with coordinates"}>{markerCoverage.vehicleKeys.length}/{positionedMapRecords.length} {language === "th" ? "บนแผนที่" : "on map"}</span>
                {visibleMapKeys ? <span className="is-coords" title={language === "th" ? "ในมุมมองปัจจุบัน" : "Inside current viewport"}>{visibleMapKeys.length} {language === "th" ? "ในมุมมอง" : "in view"}</span> : null}
                {markerCoverage.screenOverlapCount > 0 ? <span className="is-overlap" title={language === "th" ? "หมุดที่ทับกันบนหน้าจอ เลือกตัวเลขที่หมุดเพื่อดูทะเบียน" : "Screen-overlapping symbols; select the marker count to see registrations"}>{markerCoverage.screenOverlapCount} {language === "th" ? "ทับกัน" : "overlap"}</span> : null}
                {markerCoverage.sharedPositionCount > 0 ? <span className="is-overlap" title={language === "th" ? "ตำแหน่งรายงานร่วมกัน" : "Genuinely shared reported positions"}>{markerCoverage.sharedPositionCount} {language === "th" ? "ตำแหน่งร่วม" : "shared"}</span> : null}
                {unmappedPositionCount > 0 ? <span className="is-missing" role="status">{unmappedPositionCount} {copy.noPosition}</span> : null}
              </div>
            ) : unmappedPositionCount > 0 ? (
              <span className="forth-map-coverage-alert" role="status">{unmappedPositionCount} {copy.noPosition}</span>
            ) : null}
          </div>
        ) : null}
        {drivingOutsideOpen && drivingOutsideRecords.length > 0 ? (
          <section className="forth-offscreen-panel forth-driving-outside-panel" aria-label={copy.drivingOutsideArea}>
            <div className="forth-offscreen-heading">
              <div>
                <strong>{drivingOutsideRecords.length} {copy.drivingOutsideArea}</strong>
                <p>{language === "th" ? "ยังอยู่ในจอภาพกองรถ — ไม่ได้หายไปจากกองรถ" : "Still listed in Fleet Monitor — not missing from the fleet."}</p>
              </div>
              <button type="button" aria-label={language === "th" ? "ปิด" : "Close"} onClick={() => setDrivingOutsideOpen(false)}><X className="h-4 w-4" /></button>
            </div>
            <div className="forth-driving-outside-actions">
              <button type="button" className="btn-secondary" onClick={() => { setDrivingOutsideOpen(false); showDrivingOnMap(); }}>{copy.showAllDriving}</button>
              <button type="button" className="btn-secondary" onClick={() => { setDrivingOutsideOpen(false); applyCameraMode("bangkok"); }}>{copy.returnCoreOps}</button>
            </div>
            <div className="forth-offscreen-list">
              {drivingOutsideRecords.map(({ key, record }) => (
                <button key={key} type="button" onClick={() => { setDrivingOutsideOpen(false); selectVehicle(key, { focusMap: true }); }}>
                  <strong>{record.vehicleRegistration || copy.unknownValue}</strong>
                  <span>{record.speed === null ? "—" : `${record.speed} km/h`} · {copy.activityDriving}</span>
                  <small>
                    {getForthLocationArea(record, language) ?? copy.noPlaceDescription}
                    {" · "}
                    {isForthGpsPositionVerified(record) ? copy.gpsPositionVerified : copy.mapNotMappedShort}
                    {" · "}
                    {formatForthRelativeAge(record.lastGpsTimestamp, Date.now(), language) ?? timestampStatusLabel(record, copy)}
                  </small>
                </button>
              ))}
            </div>
          </section>
        ) : null}
        {outsideCoreOpen && outsideCoreRecords.length > 0 ? (
          <section className="forth-offscreen-panel forth-outside-core-panel" aria-label={language === "th" ? "นอกลำดับปฏิบัติการหลัก" : "Outside Core Operations"}>
            <div className="forth-offscreen-heading">
              <div>
                <strong>{language === "th" ? "นอกลำดับปฏิบัติการหลัก" : "Outside Core Operations"}</strong>
                <p>{language === "th" ? "มีพิกัดนอกกรุงเทพฯ–ชายฝั่งตะวันออก ยังอยู่ในจอภาพกองรถ" : "Reported outside Bangkok–Eastern Seaboard corridor; still listed in Fleet Monitor."}</p>
              </div>
              <button type="button" aria-label={language === "th" ? "ปิด" : "Close"} onClick={() => setOutsideCoreOpen(false)}><X className="h-4 w-4" /></button>
            </div>
            <div className="forth-offscreen-list">
              {outsideCoreRecords.map(({ key, record }) => {
                const confirmedDriver = confirmedAssignedDriver(record, eesVehicles);
                const forthDriver = record.reportedDriver && record.reportedDriver !== confirmedDriver ? record.reportedDriver : null;
                const driverLine = confirmedDriver
                  ? `${copy.confirmedDriverLabel} · ${confirmedDriver}`
                  : forthDriver
                    ? `${copy.forthDriverUnverified}: ${forthDriver}`
                    : null;
                return (
                  <button key={key} type="button" onClick={() => { setOutsideCoreOpen(false); selectVehicle(key, { focusMap: true }); }}>
                    <strong>{record.vehicleRegistration || copy.unknownValue}</strong>
                    <span>{driverLine ?? (language === "th" ? "ยังไม่ยืนยันผู้ขับ" : "Driver not confirmed")}</span>
                    <small>
                      {getForthLocationArea(record, language) ?? copy.noPlaceDescription}
                      {" · "}
                      {record.speed === null ? "—" : `${record.speed} km/h`}
                      {" · "}
                      {isForthGpsPositionVerified(record) ? copy.gpsPositionVerified : copy.gpsPositionUnverified}
                      {" · "}
                      {formatForthRelativeAge(record.lastGpsTimestamp, Date.now(), language) ?? timestampStatusLabel(record, copy)}
                    </small>
                  </button>
                );
              })}
            </div>
            <p className="forth-offscreen-note">{language === "th" ? "ต่างจากนอกมุมมองปัจจุบัน และจากพิกัดที่หายไปหรือยังไม่ยืนยัน GPS" : "Different from outside current viewport, missing coordinates, or GPS-unverified."}</p>
          </section>
        ) : null}
        {offscreenOpen && offscreenMapRecords.length > 0 ? <section id="forth-offscreen-vehicles" className="forth-offscreen-panel" aria-label={copy.mapFitAllGps}>
          <div className="forth-offscreen-heading"><div><strong>{copy.mapFitAllGps}</strong><p>{language === "th" ? "ตำแหน่งที่รายงาน เลือกรถเพื่อจัดมุมมองแผนที่" : "Select a vehicle to centre its reported position."}</p></div><button type="button" aria-label={language === "th" ? "ปิด" : "Close"} onClick={() => setOffscreenOpen(false)}><X className="h-4 w-4" /></button></div>
          <div className="forth-offscreen-list">{offscreenMapRecords.map(({ key, record }) => <button key={key} type="button" onClick={() => { setOffscreenOpen(false); selectVehicle(key, { focusMap: true }); }}><strong>{record.vehicleRegistration || copy.unknownValue}</strong><span title={getForthLocationDescription(record, language) ?? undefined}>{getForthLocationArea(record, language) ?? copy.noPlaceDescription}</span><small>{isForthGpsPositionVerified(record) ? copy.gpsPositionVerified : copy.gpsPositionUnverified} · {formatForthRelativeAge(record.lastGpsTimestamp, Date.now(), language) ?? timestampStatusLabel(record, copy)}</small></button>)}</div>
          <p className="forth-offscreen-note">{summary.positionConfidence.notGpsVerified} {copy.mapUnverifiedInMonitor}</p>
        </section> : null}
        {sharedLocationKeys && sharedLocationKeys.length > 0 ? (
          <section className={`forth-shared-picker forth-group-selector${sharedLocationKeys.length > 8 ? " is-tall" : ""}`} aria-label={sharedLocationKind === "map_overlap" ? copy.mapOverlapTitle : copy.sharedHere}>
            <div className="forth-shared-header">
              <div>
                <h2 className="text-sm font-bold text-slate-950">{sharedLocationKind === "map_overlap" ? copy.mapOverlapTitle : copy.sharedHere}</h2>
                <p className="text-xs leading-5 text-slate-500">{sharedLocationKind === "map_overlap" ? copy.mapOverlapHint : copy.sharedHint} · {sharedLocationKeys.length}</p>
              </div>
              <button type="button" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label={language === "th" ? "ปิดรายการ" : "Close list"} onClick={() => setSharedLocationKeys(null)}><X className="h-4 w-4" /></button>
            </div>
            {sharedLocationKeys.length > 8 ? (
              <label className="relative mb-2 block">
                <span className="sr-only">{copy.sharedSearch}</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input value={sharedLocationQuery} onChange={(event) => setSharedLocationQuery(event.target.value)} placeholder={copy.sharedSearch} type="search" className="min-h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100" />
              </label>
            ) : null}
            <div className="forth-group-selector-list">
              {sharedLocationKeys.flatMap((key) => {
                const record = data ? findForthFleetRecord(fleetRecords, key) : null;
                if (!record) return [];
                const query = sharedLocationQuery.trim().toLocaleLowerCase();
                if (query && !(record.vehicleRegistration ?? "").toLocaleLowerCase().includes(query)) return [];
                const age = formatForthRelativeAge(record.lastGpsTimestamp, Date.now(), language);
                const verified = isForthGpsPositionVerified(record);
                const activity = getForthReportedActivity(record);
                const activityKind = activity === "driving"
                  ? copy.activityDriving
                  : activity === "uncertain"
                    ? copy.activityUncertain
                    : activity.startsWith("stopped")
                      ? copy.parked
                      : copy.activityUnavailable;
                return [(
                  <button key={key} type="button" aria-pressed={key === selectedKey} className={`forth-shared-row forth-group-row${key === selectedKey ? " is-selected" : ""}${activity === "driving" ? " is-driving" : ""}`} onClick={() => selectVisibleMapVehicle(key)}>
                    <span className="min-w-0">
                      <strong className="block truncate text-sm text-slate-950">{record.vehicleRegistration || copy.unknownValue}</strong>
                      <span className="block truncate text-[11px] text-slate-500">{activityKind} · {verified ? copy.gpsPositionVerified : copy.mapNotMappedShort} · {age ?? timestampStatusLabel(record, copy)}</span>
                    </span>
                    <span className={`forth-group-row-speed${activity === "driving" ? " is-driving" : ""}`}>
                      <strong>{record.speed === null ? "—" : record.speed}</strong>
                      {record.speed === null ? null : <small>km/h</small>}
                    </span>
                  </button>
                )];
              })}
            </div>
          </section>
        ) : null}

        {/* Speed Watch is an on-demand overlay independent of the active sidebar section. */}
        </div>
        <aside id="forth-attention-dock" className="forth-attention-dock" aria-label={language === "th" ? "พื้นที่ตรวจสอบกองรถ" : "Fleet attention dock"} />
      </div>
      ) : (
      <div className="v71-shell" data-workspace={intelligenceSection}>
        {headerNode}
        <aside id="forth-attention-dock" className="forth-attention-dock v71-attention-dock" aria-label={language === "th" ? "พื้นที่ตรวจสอบกองรถ" : "Fleet attention dock"} />
        <div className="v71-body">
          {intelligenceSection === "reports" ? (
            <div className="v71-workspace v71-reports-workspace" data-workspace="reports">
              <div className="v71-workspace-head"><h2>{language === "th" ? "รายงาน" : "Reports"}</h2><p>{language === "th" ? "ภาพรวมกองรถรายวัน เรียงรายการผิดปกติสำคัญก่อน ยอดรวมครอบคลุมเฉพาะรถ-วันที่แสดง และไม่อ่าน Forth จนกว่าคุณจะสั่ง" : "Fleet-wide daily review with critical exceptions first. Totals cover only the vehicle-days shown, and nothing is read from Forth until you ask."}</p></div>
              <FleetDayReview language={language} onVehicle={openReviewedVehicleDay} />
              <FleetFuelReport language={language} onVehicle={openFuelOversightVehicle} initialScope={evidenceScope} onScopeChange={(scope) => setEvidenceScope({ ...scope, day: scope.to })} />
              <FleetRecurringAreas language={language} onOpenDay={openReviewedVehicleDay} />
              <FleetLocationCrossRef language={language} />
              <details className="fleet-legacy-reports" data-legacy-reports><summary>{language === "th" ? "เปรียบเทียบระยะทาง ไมล์ และเชื้อเพลิง (มุมมองเดิม)" : "Distance, mileage and fuel comparison (earlier view)"}</summary>
                <FleetDailyReport language={language} onVehicle={(registration) => openVehicleWorkspace(registration, "daily")} />
                <FleetMileageReport language={language} onVehicle={(registration) => openVehicleWorkspace(registration, "daily")} />
              </details>
            </div>
          ) : (
            <div className="v71-workspace" data-workspace={intelligenceSection}>
              <div className="v71-workspace-head">
                <h2>{intelligenceSection === "daily" ? (language === "th" ? "กิจกรรมประจำวัน" : "Daily Activity") : intelligenceSection === "fuel" ? (language === "th" ? "ข้อมูลเชื้อเพลิง" : "Fuel Intelligence") : (language === "th" ? "เส้นทางและงาน" : "Journeys & Jobs")}</h2>
                <p>{intelligenceSection === "daily"
                  ? (language === "th" ? "สิ่งที่รถหนึ่งคันทำในหนึ่งวัน (เวลาไทย) ระยะทาง การยืนยัน GPS จุดจอด และช่วงที่ไม่มีข้อมูล ไม่อ่านข้อมูลจนกว่าคุณจะกดอ่าน" : "What one vehicle did on one Bangkok day: distance, GPS verification, stops and coverage gaps. Nothing is read until you press a read button.")
                  : intelligenceSection === "fuel"
                    ? (language === "th" ? "เชื้อเพลิงที่ซื้อ (ไม่ใช่ที่ใช้จริง) เลขไมล์ และการเปรียบเทียบแหล่งข้อมูล ไม่คำนวณอัตราสิ้นเปลือง" : "Fuel purchased (not consumed), odometer evidence and source comparison. No fuel efficiency is calculated.")
                    : (language === "th" ? "เที่ยวรถ จุดจอด และพื้นที่ที่แวะซ้ำตามช่วงวันที่ การจองเป็นข้อมูลเสริมและไม่บังคับ" : "Historical journeys, stops and recurring places for the chosen dates. Bookings are optional and secondary.")}</p>
              </div>
              <FleetVehicleBar language={language} options={vehicleOptions} value={activeEesVehicle?.id ?? null} onChange={(id) => { setReviewDrill(null); chooseWorkspaceVehicle(id); }}
                summary={selectedRecord ? <>
                  <ActivityPill activity={getForthReportedActivity(selectedRecord)} copy={copy} compact />
                  <span className={`v7-chip ${isForthGpsPositionVerified(selectedRecord) ? "is-verified" : "is-unverified"}`}>{isForthGpsPositionVerified(selectedRecord) ? (language === "th" ? "GPS ยืนยัน" : "GPS verified") : (language === "th" ? "GPS ไม่ยืนยัน" : "GPS unverified")}</span>
                  <span className="v7-chip">{selectedPositionAge ?? timestampStatusLabel(selectedRecord, copy)}</span>
                </> : null}>
                {selectedRecord ? <button type="button" className="v71-link-button" onClick={() => goWorkspace("live")}><MapPinned className="h-4 w-4" aria-hidden="true" />{language === "th" ? "ดูบนแผนที่สด" : "Show on live map"}</button> : null}
              </FleetVehicleBar>
              {activeEesVehicle ? (
                <FleetEvidencePanel key={`${activeEesVehicle.id}:${reviewDrill && normaliseRegistration(reviewDrill.registration) === normaliseRegistration(activeEesVehicle.vehicle_reg) ? reviewDrill.day : ""}`}
                  initialDay={reviewDrill && normaliseRegistration(reviewDrill.registration) === normaliseRegistration(activeEesVehicle.vehicle_reg) ? reviewDrill.day : undefined}
                  initialScope={evidenceScope} onScopeChange={setEvidenceScope}
                  vehicleId={activeEesVehicle.id} language={language}
                  section={intelligenceSection === "daily" ? "daily" : intelligenceSection === "fuel" ? "fuel" : "journeys_jobs"}
                  onNavigate={(target) => goWorkspace(target === "today" || target === "health" ? "daily" : target === "journeys" || target === "jobs" ? "journeys" : target === "fuel" ? "fuel" : "live")}
                  onOpenPlayback={openRouteMap} gpsHealth={gpsHealthNode ?? <p className="fleet-evidence-note">{language === "th" ? "ไม่มีข้อมูลสดของรถคันนี้ในขณะนี้ เลือกรถจากแผนที่สดเพื่อดูสถานะ GPS" : "No live record for this vehicle right now. Select it on the live map for GPS health."}</p>} />
              ) : (
                <div className="v71-empty" role="status">
                  <strong>{language === "th" ? "เลือกรถเพื่อเริ่ม" : "Choose a vehicle to begin"}</strong>
                  <p>{language === "th" ? "เลือกจากรายการด้านบน หรือเปิดแผนที่สดแล้วกด “ดูกิจกรรม / เส้นทาง / เชื้อเพลิง” จากรถที่เลือก" : "Pick one above, or select a truck on the live map and use View activity, View journeys or View fuel."}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      )}
      {connected && can("business:read") && speedConfigOpen ? (
        <div className="fixed inset-0 z-[900] flex justify-end bg-slate-950/45">
          <button type="button" className="absolute inset-0" aria-label={copy.speedSettings} onClick={() => setSpeedConfigOpen(false)} />
          <aside role="dialog" aria-modal="true" aria-label={copy.speedSettings} className="relative z-[901] flex h-full w-full max-w-5xl flex-col border-l border-slate-200 bg-slate-50 shadow-2xl">
            <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
              <ForthSpeedConfigPanel
                language={language}
                records={fleetRecords}
                eesVehicles={eesVehicles}
                onClose={() => setSpeedConfigOpen(false)}
              />
            </div>
          </aside>
        </div>
      ) : null}
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
