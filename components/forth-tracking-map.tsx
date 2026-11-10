"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import "maplibre-gl/dist/maplibre-gl.css";
import styles from "./forth-tracking-map.module.css";
import {
  getForthFleetMapRecords,
  getForthFleetMapInitialFrame,
  getForthReportedActivity,
  getForthSharedLocationGroups,
  getForthTrackingVehicleIdentity,
  getForthLocationArea,
  formatForthRelativeAge,
  isForthGpsPositionVerified,
  type ForthReportedActivity,
  type ForthTrackingMapVehicleClass
} from "@/lib/forth-tracking-view";
import type { ForthFleetTrackingRecord } from "@/lib/forth-tracking-server";
import {
  attachEesLeafletBasemap,
  eesLeafletAttributionHtml,
  eesLeafletMapInitOptions
} from "@/lib/ees-map-tiles-leaflet";
import {
  forthMarkerDiscPxForZoom,
  forthMarkerIconAnchorForZoom,
  forthMarkerIconSizeForZoom,
  planForthMarkerLabels,
  getForthScreenOverlapGroups
} from "@/lib/forth-marker-geometry";
import {
  FORTH_BANGKOK_OPS_BOUNDS,
  FORTH_BANGKOK_OPS_CENTER,
  FORTH_BANGKOK_OPS_ZOOM,
  FORTH_THAILAND_NEIGHBOURS_BOUNDS,
  FORTH_THAILAND_NEIGHBOURS_CENTER,
  FORTH_THAILAND_NEIGHBOURS_ZOOM
} from "@/lib/forth-map-ops";
import type { FleetDirectoryLocation } from "@/lib/forth-fleet-locations";
import type { ForthGpsMapLocation } from "@/lib/forth-gps-map-locations";
import { createForthHoverIntent } from "@/lib/forth-hover-intent";
import {
  buildForthGpsClusterIconHtml,
  forthGpsClusterIconAnchor,
  forthGpsClusterIconSize,
  forthGpsClusterMaxRadius,
  forthGpsDisableClusteringAtZoom
} from "@/lib/forth-gps-map-cluster";
import { buildForthVehicleMarkerGlyphHtml } from "@/lib/forth-vehicle-icons";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";

const FORTH_GPS_MAP_PANE = "forthGpsPane";

type Copy = {
  driving: string;
  uncertain: string;
  stopped: string;
  unavailable: string;
  gpsVerified: string;
  notGpsVerified: string;
  groupVehicles: string;
  expandGroup: string;
  engineOn: string;
  engineOff: string;
  unknownValue: string;
  noPositions: string;
  loading: string;
  mapUnavailable: string;
  mapRegionLabel: string;
  sharedLocation?: string;
};

type ViewCommand = {
  type: "fit" | "fit_all" | "bangkok" | "thailand_neighbours" | "focus" | "focus_location" | "fit_locations";
  sequence: number;
  key?: string | null;
  zoom?: number;
  location?: { latitude: number; longitude: number } | null;
  locations?: Array<{ latitude: number; longitude: number }>;
};

type Props = {
  records: ForthFleetTrackingRecord[];
  selectedKey: string | null;
  confirmedDriverFor?: (record: ForthFleetTrackingRecord) => string | null;
  emphasizedKeys?: string[];
  onSelect: (key: string) => void;
  onSharedLocation?: (keys: string[], kind?: "reported_position" | "map_overlap") => void;
  onViewportKeys?: (keys: string[]) => void;
  onMarkerCoverage?: (coverage: { vehicleKeys: string[]; symbolCount: number; readableRegistrationCount: number; screenOverlapCount: number; sharedPositionCount: number }) => void;
  command: ViewCommand;
  filterKey: string;
  announceEmpty?: boolean;
  language: "en" | "th";
  copy: Copy;
  directoryLocations?: FleetDirectoryLocation[];
  forthGpsLocations?: ForthGpsMapLocation[];
  locationsVisible?: boolean;
  vehiclesVisible?: boolean;
  selectedLocationId?: string | null;
  onSelectLocation?: (id: string) => void;
  /** Historical journey overlay — distinct from live fleet markers. */
  playback?: {
    active: boolean;
    points: Array<{
      index: number;
      latitude: number | null;
      longitude: number | null;
      verifiedGps: boolean;
      trailEligible?: boolean;
      isGapEdge?: boolean;
    }>;
    segments: Array<{ fromIndex: number; toIndex: number }>;
    reportedTrailSegments?: Array<{ fromIndex: number; toIndex: number }>;
    cursorIndex: number;
    registration?: string | null;
  } | null;
  onSelectPlaybackPoint?: (index: number) => void;
};

type LeafletModule = typeof import("leaflet");
type FleetMarker = import("leaflet").Marker;
type FleetMarkerEntry = {
  marker: FleetMarker;
  activity: ForthReportedActivity;
  approximate: boolean;
  offline: boolean;
  selected: boolean;
  vehicleClass: ForthTrackingMapVehicleClass;
  make: string | null;
  title: string;
  tooltipSignature: string;
  preview: HTMLElement | null;
  onMap: boolean;
  overlapCount: number;
};
type StackMarkerEntry = {
  marker: FleetMarker;
  memberKeys: string[];
  signature: string;
  accent: "driving" | "attention" | "mixed" | "neutral";
};

function activityLabel(activity: ForthReportedActivity, copy: Copy) {
  if (activity === "driving") return copy.driving;
  if (activity === "uncertain") return copy.uncertain;
  if (activity === "stopped_engine_on") return copy.stopped + " · " + copy.engineOn;
  if (activity === "stopped_engine_off") return copy.stopped + " · " + copy.engineOff;
  if (activity === "stopped_engine_unknown") return copy.stopped + " · " + copy.unknownValue;
  return copy.unavailable;
}

/** One-off camera move onto a loaded journey. Kept out of the marker-refresh effect, which must never move the camera. */
function frameJourneyCamera(
  map: import("leaflet").Map,
  Leaflet: typeof import("leaflet"),
  positions: [number, number][]
) {
  map.invalidateSize?.({ pan: false });
  if (positions.length === 1) map.setView(positions[0], 15, { animate: false });
  else map.fitBounds(Leaflet.latLngBounds(positions), { padding: [56, 56], maxZoom: 15, animate: false });
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("'", "&#39;");
}

export function quickView(record: ForthFleetTrackingRecord, title: string, activity: ForthReportedActivity, confidence: string, copy: Copy, language: "en" | "th", confirmedDriver: string | null) {
  const root = document.createElement("div");
  root.className = styles.vehicleQuickView;
  const heading = document.createElement("div");
  heading.className = styles.vehicleQuickHeading;
  const registration = document.createElement("strong");
  registration.textContent = title;
  const speed = document.createElement("span");
  speed.textContent = `${record.speed ?? "—"} km/h`;
  heading.append(registration, speed);
  root.append(heading);
  const motion = document.createElement("p");
  motion.className = styles.vehicleQuickMotion;
  motion.textContent = activityLabel(activity, copy);
  root.append(motion);
  const driver = confirmedDriver ?? record.reportedDriver ?? null;
  const driverStatus = confirmedDriver
    ? (language === "th" ? "ผู้ขับที่มอบหมาย" : "Assigned driver")
    : record.reportedDriver
      ? (language === "th" ? "Forth รายงาน · ยังไม่ยืนยัน" : "Forth reported · unverified")
      : (language === "th" ? "ยังไม่ยืนยันผู้ขับ" : "Driver not confirmed");
  const driverLine = document.createElement("p");
  driverLine.className = styles.vehicleQuickDriver;
  driverLine.textContent = driver ? `${driver} · ${driverStatus}` : driverStatus;
  root.append(driverLine);
  const location = document.createElement("p");
  location.className = styles.vehicleQuickLocation;
  location.textContent = getForthLocationArea(record, language) ?? (language === "th" ? "ไม่มีคำอธิบายตำแหน่ง" : "Location unavailable");
  root.append(location);
  const report = document.createElement("div");
  report.className = styles.vehicleQuickReport;
  const age = document.createElement("span");
  age.textContent = formatForthRelativeAge(record.lastGpsTimestamp, Date.now(), language) ?? copy.unknownValue;
  const trust = document.createElement("span");
  trust.textContent = confidence;
  report.append(age, trust);
  root.append(report);
  return root;
}

function activityStatusClass(activity: ForthReportedActivity | null) {
  if (!activity) return styles.vehicleMarkerStack;
  if (activity === "driving") return styles.vehicleMarkerDriving;
  if (activity === "uncertain") return styles.vehicleMarkerUncertain;
  if (activity === "stopped_engine_on") return styles.vehicleMarkerStoppedEngineOn;
  if (activity === "stopped_engine_off") return styles.vehicleMarkerStoppedEngineOff;
  if (activity === "stopped_engine_unknown") return styles.vehicleMarkerStoppedEngineUnknown;
  return styles.vehicleMarkerUnavailable;
}

function activityBadgeClass(activity: ForthReportedActivity | null) {
  if (!activity) return styles.vehicleMarkerBadgeUnavailable;
  if (activity === "driving") return styles.vehicleMarkerBadgeDriving;
  if (activity === "uncertain") return styles.vehicleMarkerBadgeUncertain;
  if (activity === "stopped_engine_on") return styles.vehicleMarkerBadgeStoppedEngineOn;
  if (activity === "stopped_engine_off") return styles.vehicleMarkerBadgeStoppedEngineOff;
  if (activity === "stopped_engine_unknown") return styles.vehicleMarkerBadgeStoppedEngineUnknown;
  return styles.vehicleMarkerBadgeUnavailable;
}

function classShortLabel(vehicleClass: ForthTrackingMapVehicleClass): string | null {
  if (vehicleClass === "four_wheeler") return "4W";
  if (vehicleClass === "six_wheeler") return "6W";
  if (vehicleClass === "six_plus_six_wheeler") return "6+6";
  if (vehicleClass === "eighteen_wheeler") return "18W";
  return null;
}

export function markerIcon(
  Leaflet: LeafletModule,
  activity: ForthReportedActivity,
  selected: boolean,
  approximate: boolean,
  offline: boolean,
  registration: string,
  vehicleClass: ForthTrackingMapVehicleClass,
  _make: string | null,
  labelOnLeft = false,
  zoom = 14,
  overlapCount = 1
) {
  const statusClass = activityStatusClass(activity);
  const iconSize = forthMarkerIconSizeForZoom(zoom);
  const iconAnchor = forthMarkerIconAnchorForZoom(zoom);
  const disc = forthMarkerDiscPxForZoom(zoom);
  const truckClass = disc <= 28 ? `${styles.vehicleMarkerTruck} ${styles.vehicleMarkerTruckCompact}` : styles.vehicleMarkerTruck;
  const drivingBoost = activity === "driving" ? ` ${styles.vehicleMarkerDrivingBoost}` : "";
  const activityBadge = `<em class="${styles.vehicleMarkerActivityBadge} ${activityBadgeClass(activity)}" aria-hidden="true"></em>`;
  const glyph = buildForthVehicleMarkerGlyphHtml(vehicleClass, truckClass);
  const trustKind = offline ? "stale" : approximate ? "unverified" : "verified";
  const trustTitle = offline ? "Stale / offline" : approximate ? "GPS not verified" : "GPS verified";
  const trustMark = `<span class="${styles.vehicleMarkerTrust}" data-trust="${trustKind}" title="${trustTitle}" aria-hidden="true"></span>`;
  const classLabel = zoom >= 12 ? classShortLabel(vehicleClass) : null;
  const classMark = classLabel ? `<em class="${styles.vehicleMarkerClass}">${classLabel}</em>` : "";
  const overlapMark = overlapCount > 1
    ? `<strong class="${styles.vehicleMarkerAreaCount}" title="${overlapCount} vehicles near this map position">×${overlapCount}</strong>`
    : "";
  return Leaflet.divIcon({
    className: styles.vehicleMarker,
    html:
      `<span class="${styles.vehicleMarkerUnit}" data-class="${vehicleClass}">` +
      `<span class="${styles.vehicleMarkerDot} ${statusClass}${drivingBoost}` +
      (approximate ? ` ${styles.vehicleMarkerApproximate}` : "") +
      (offline ? ` ${styles.vehicleMarkerOffline}` : "") +
      (selected ? ` ${styles.vehicleMarkerSelected}` : "") +
      `" data-class="${vehicleClass}">` +
      activityBadge + glyph + trustMark + overlapMark +
      `</span>` +
      `<span class="${styles.vehicleMarkerLabel} ${styles.vehicleMarkerLabelAttached} ${statusClass}` +
      (labelOnLeft ? ` ${styles.vehicleMarkerLabelLeft}` : "") +
      (selected ? ` ${styles.vehicleMarkerLabelSelected}` : "") +
      (approximate ? ` ${styles.vehicleMarkerLabelApproximate}` : "") +
      `">` +
      `<strong>${escapeHtml(registration)}</strong>${classMark}</span>` +
      `</span>`,
    // Icon box is the disc only. Labels overflow; they must not widen iconSize/iconAnchor
    // or a fixed pixel error becomes kilometres when zoomed out.
    iconSize,
    iconAnchor,
    tooltipAnchor: [0, -iconAnchor[1]]
  });
}

type ForthGpsClusterLike = { getChildCount: () => number };

export function forthGpsClusterIconCreateFunction(Leaflet: LeafletModule, cluster: ForthGpsClusterLike) {
  const count = cluster.getChildCount();
  const iconSize = forthGpsClusterIconSize(count);
  return Leaflet.divIcon({
    className: styles.forthGpsClusterMarker,
    html: buildForthGpsClusterIconHtml(count, {
      shell: styles.forthGpsClusterShell,
      body: styles.forthGpsClusterBody,
      count: styles.forthGpsClusterCount,
      tag: styles.forthGpsClusterTag
    }),
    iconSize,
    iconAnchor: forthGpsClusterIconAnchor(iconSize)
  });
}

export function stackIcon(
  Leaflet: LeafletModule,
  count: number,
  selected: boolean,
  approximate: boolean,
  activity: ForthReportedActivity | null,
  registration: string | null,
  zoom = 14,
  accent: "driving" | "attention" | "mixed" | "neutral" = "neutral"
) {
  const statusClass = activityStatusClass(activity);
  const accentClass = accent === "driving"
    ? styles.vehicleStackAccentDriving
    : accent === "attention"
      ? styles.vehicleStackAccentAttention
      : accent === "mixed"
        ? styles.vehicleStackAccentMixed
        : styles.vehicleStackAccentNeutral;
  const iconSize = forthMarkerIconSizeForZoom(zoom);
  const iconAnchor = forthMarkerIconAnchorForZoom(zoom);
  const disc = forthMarkerDiscPxForZoom(zoom);
  const truckClass = disc <= 26 ? `${styles.vehicleMarkerTruck} ${styles.vehicleMarkerTruckCompact}` : styles.vehicleMarkerTruck;
  // The disc already carries the count; keep map text for a selected or emphasized registration.
  const label = registration
    ? `<span class="${styles.vehicleMarkerLabel} ${statusClass}${selected ? ` ${styles.vehicleMarkerLabelSelected}` : ""}${approximate ? ` ${styles.vehicleMarkerLabelApproximate}` : ""}"><strong>${escapeHtml(registration)}</strong></span>`
    : "";
  const accentMark = accent === "driving" || accent === "mixed"
    ? `<em class="${styles.vehicleStackPulse}" aria-hidden="true"></em>`
    : accent === "attention"
      ? `<em class="${styles.vehicleStackAttention}" aria-hidden="true"></em>`
      : "";
  return Leaflet.divIcon({
    className: styles.vehicleMarker,
    html: `<span class="${styles.vehicleMarkerDot} ${styles.vehicleMarkerStack} ${accentClass}${approximate ? ` ${styles.vehicleMarkerApproximate}` : ""}${selected ? ` ${styles.vehicleMarkerSelected}` : ""}">${buildForthVehicleMarkerGlyphHtml("six_wheeler", truckClass)}${accentMark}<strong class="${styles.vehicleStackCount}">${count}</strong></span>${label}`,
    iconSize,
    iconAnchor,
    tooltipAnchor: [0, -iconAnchor[1]]
  });
}

function fitFleet(map: import("leaflet").Map, Leaflet: LeafletModule, positions: [number, number][], inspectorOpen = false) {
  if (positions.length === 0) return;
  map.invalidateSize?.({ pan: false });
  const first = positions[0];
  const allSamePosition = positions.every((position) => position[0] === first[0] && position[1] === first[1]);
  const size = map.getSize();
  const mapRect = map.getContainer().getBoundingClientRect();
  const workspace = map.getContainer().closest(".forth-tracking-grid");
  const roster = workspace?.querySelector<HTMLElement>(".forth-roster")?.getBoundingClientRect();
  const toolbar = workspace?.querySelector<HTMLElement>(".forth-float-toolbar")?.getBoundingClientRect();
  const inspector = inspectorOpen ? workspace?.querySelector<HTMLElement>(".forth-vehicle-card:not(.hidden)")?.getBoundingClientRect() : null;
  const leftPad = roster && roster.width > 0 && roster.height > 0 ? Math.max(24, roster.right - mapRect.left + 24) : 28;
  const topPad = toolbar && toolbar.height > 0 ? Math.max(45, toolbar.bottom - mapRect.top + 24) : 116;
  const inspectorOverlapsMap = inspector && inspector.width > 0 && inspector.height > 0 && inspector.right > mapRect.left && inspector.left < mapRect.right;
  const rightPad = inspectorOverlapsMap && inspector.width < size.x * .7 ? Math.max(36, mapRect.right - inspector.left + 24) : 36;
  const bottomPad = inspectorOverlapsMap && inspector.width >= size.x * .7 ? Math.max(52, mapRect.bottom - inspector.top + 24) : 52;
  const padding = { paddingTopLeft: [Math.min(leftPad, size.x * .4), Math.min(topPad, size.y * .4)] as [number, number], paddingBottomRight: [Math.min(rightPad, size.x * .4), Math.min(bottomPad, size.y * .4)] as [number, number], maxZoom: 13, animate: true };
  if (positions.length === 1 || allSamePosition) map.setView(first, 14, { animate: true });
  else map.fitBounds(Leaflet.latLngBounds(positions), padding);
}

/** Apply commands only once their target exists, so a selection during loading is not lost. */
export function applyForthMapViewCommand(
  map: import("leaflet").Map,
  Leaflet: LeafletModule,
  command: ViewCommand,
  positions: [number, number][],
  markers: Map<string, { marker: FleetMarker }>,
  inspectorOpen: boolean,
  framingPositions: [number, number][] = positions
) {
  if (command.type === "bangkok") {
    // Camera-only Core Operations corridor — markers keep Forth coordinates.
    map.stop();
    map.fitBounds(Leaflet.latLngBounds(FORTH_BANGKOK_OPS_BOUNDS), {
      padding: [40, 40],
      maxZoom: FORTH_BANGKOK_OPS_ZOOM,
      animate: true
    });
    if (map.getZoom() < 8) map.setView(FORTH_BANGKOK_OPS_CENTER, FORTH_BANGKOK_OPS_ZOOM, { animate: true });
    return true;
  }
  if (command.type === "thailand_neighbours") {
    map.stop();
    map.fitBounds(Leaflet.latLngBounds(FORTH_THAILAND_NEIGHBOURS_BOUNDS), {
      padding: [36, 36],
      maxZoom: FORTH_THAILAND_NEIGHBOURS_ZOOM,
      animate: true
    });
    if (map.getZoom() < 5) map.setView(FORTH_THAILAND_NEIGHBOURS_CENTER, FORTH_THAILAND_NEIGHBOURS_ZOOM, { animate: true });
    return true;
  }
  if (command.type === "focus_location" && command.location) {
    map.stop();
    map.flyTo([command.location.latitude, command.location.longitude], Math.max(map.getZoom(), 14), { duration: 0.4 });
    return true;
  }
  if (command.type === "fit_locations" && command.locations?.length) {
    map.stop();
    const points = command.locations.map((location) => [location.latitude, location.longitude] as [number, number]);
    if (points.length === 1) map.setView(points[0], 14, { animate: true });
    else map.fitBounds(Leaflet.latLngBounds(points), { padding: [48, 48], maxZoom: 12, animate: true });
    return true;
  }
  if (command.type === "fit" || command.type === "fit_all") {
    const targetPositions = command.type === "fit_all"
      ? positions
      : getForthFleetMapInitialFrame(framingPositions).focusPositions;
    if (targetPositions.length === 0) return false;
    fitFleet(map, Leaflet, targetPositions, inspectorOpen);
    // Fit every valid source position. A regional floor would silently exclude
    // distant vehicles while claiming to show the full fleet.
    return true;
  }
  if (!command.key) return false;
  const marker = markers.get(command.key)?.marker;
  if (!marker) return false;

  map.invalidateSize?.({ pan: false });

  const zoom = typeof command.zoom === "number" && Number.isFinite(command.zoom)
    ? Math.min(16, Math.max(14, command.zoom))
    : Math.min(16, Math.max(14, map.getZoom()));
  const size = map.getSize();
  const mapRect = map.getContainer().getBoundingClientRect();
  const workspace = map.getContainer().closest(".forth-tracking-grid");
  const toolbar = workspace?.querySelector<HTMLElement>(".forth-float-toolbar")?.getBoundingClientRect();
  const inspector = inspectorOpen
    ? workspace?.querySelector<HTMLElement>(".forth-vehicle-card:not(.hidden)")?.getBoundingClientRect()
    : null;
  const roster = workspace?.querySelector<HTMLElement>(".forth-roster")?.getBoundingClientRect();
  const topInset = toolbar ? Math.max(0, Math.min(size.y - 80, toolbar.bottom - mapRect.top + 16)) : 96;
  const leftInset = roster && roster.width > 0 && roster.height > 0 ? Math.max(24, roster.right - mapRect.left + 16) : 24;
  let rightInset = 24;
  let bottomInset = 40;
  if (inspector && inspector.width > 0 && inspector.height > 0 && inspector.right > mapRect.left && inspector.left < mapRect.right) {
    if (inspector.width > size.x * 0.7) bottomInset = Math.max(40, mapRect.bottom - inspector.top + 16);
    else rightInset = Math.max(24, mapRect.right - inspector.left + 20);
  }
  // Keep the marker centred in the unobscured map, rather than under the inspector.
  const point = map.project(marker.getLatLng(), zoom);
  const cameraPoint = Leaflet.point(
    point.x + Math.max(-size.x * .35, Math.min(size.x * .35, (rightInset - leftInset) / 2)),
    point.y + (Math.min(bottomInset, size.y - 80) - topInset) / 2
  );
  const center = map.unproject(cameraPoint, zoom);
  map.stop();
  map.flyTo(center, zoom, { duration: 0.45 });
  return true;
}

function locationPinIcon(Leaflet: LeafletModule, category: string, selected: boolean) {
  const safeCategory = escapeHtml(category || "Other");
  return Leaflet.divIcon({
    className: styles.locationMarker,
    html: `<span class="${styles.locationMarkerPin}${selected ? ` ${styles.locationMarkerSelected}` : ""}" data-category="${safeCategory}"><em></em></span>`,
    iconSize: [22, 28],
    iconAnchor: [11, 26],
    tooltipAnchor: [0, -24]
  });
}

function forthGpsPinIcon(Leaflet: LeafletModule, selected: boolean, linked: boolean) {
  return Leaflet.divIcon({
    className: styles.forthGpsMarker,
    html: `<span class="${styles.forthGpsMarkerPin}${selected ? ` ${styles.forthGpsMarkerSelected}` : ""}${linked ? ` ${styles.forthGpsMarkerLinked}` : ""}"><em></em></span>`,
    iconSize: [20, 26],
    iconAnchor: [10, 24],
    tooltipAnchor: [0, -22]
  });
}

export const ForthTrackingMap = memo(function ForthTrackingMap({
  records,
  selectedKey,
  confirmedDriverFor,
  emphasizedKeys = [],
  onSelect,
  onSharedLocation,
  onViewportKeys,
  onMarkerCoverage,
  command,
  filterKey,
  announceEmpty = true,
  language,
  copy,
  directoryLocations = [],
  forthGpsLocations = [],
  locationsVisible = false,
  vehiclesVisible = true,
  selectedLocationId = null,
  onSelectLocation,
  playback = null,
  onSelectPlaybackPoint
}: Props) {
  const mapNodeRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const markersByKeyRef = useRef(new Map<string, FleetMarkerEntry>());
  const stackMarkersRef = useRef(new Map<string, StackMarkerEntry>());
  const screenOverlapKeysRef = useRef(new Map<string, string[]>());
  const locationMarkersRef = useRef(new Map<string, FleetMarker>());
  const forthGpsClusterRef = useRef<import("leaflet").LayerGroup | null>(null);
  /** Bump when cluster pane/icon options change so hot reload recreates the group. */
  const forthGpsClusterSchemaRef = useRef(0);
  const FORTH_GPS_CLUSTER_SCHEMA = 3;
  const forthGpsMarkersRef = useRef(new Map<string, FleetMarker>());
  const playbackLayerRef = useRef<import("leaflet").LayerGroup | null>(null);
  // Frames the camera on a journey once when it loads. Camera only: no coordinate is added, moved or invented.
  const playbackFitKeyRef = useRef<string | null>(null);
  const leafletRef = useRef<LeafletModule | null>(null);
  const onSelectLocationRef = useRef(onSelectLocation);
  const onSelectPlaybackPointRef = useRef(onSelectPlaybackPoint);
  const onMarkerCoverageRef = useRef(onMarkerCoverage);
  const lastMarkerCoverageRef = useRef("");
  const coverageRef = useRef<{ vehicleKeys: string[]; symbolCount: number; readableRegistrationCount: number; screenOverlapCount: number; sharedPositionCount: number } | null>(null);
  const copyRef = useRef(copy);
  const languageRef = useRef(language);
  const selectedKeyRef = useRef(selectedKey);
  const emphasizedKeysRef = useRef(emphasizedKeys);
  const hoverIntentRef = useRef<ReturnType<typeof createForthHoverIntent> | null>(null);
  const refreshOpenHoverRef = useRef<(key: string) => void>(() => undefined);
  const labelUpdateRef = useRef<() => void>(() => undefined);
  const spatialUpdateRef = useRef<() => void>(() => undefined);
  const onSelectRef = useRef(onSelect);
  const onSharedLocationRef = useRef(onSharedLocation);
  const initialFitCompleteRef = useRef(false);
  const lastCommandSequenceRef = useRef(0);
  const lastSelectedKeyRef = useRef<string | null>(null);
  const lastFilterKeyRef = useRef(filterKey);
  const markerDiscPxRef = useRef(forthMarkerDiscPxForZoom(FORTH_BANGKOK_OPS_ZOOM));
  const [mapReady, setMapReady] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const [mapTilesUnavailable, setMapTilesUnavailable] = useState(false);

  const positionedRecords = useMemo(
    () => (vehiclesVisible ? getForthFleetMapRecords(records) : []),
    [records, vehiclesVisible]
  );
  const framingPositions = useMemo(() => {
    const verified = positionedRecords.filter(({ record }) => isForthGpsPositionVerified(record));
    return (verified.length > 0 ? verified : positionedRecords).map(({ position }) => position);
  }, [positionedRecords]);
  copyRef.current = copy;
  onMarkerCoverageRef.current = onMarkerCoverage;
  languageRef.current = language;
  selectedKeyRef.current = selectedKey;
  emphasizedKeysRef.current = emphasizedKeys;

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    onSharedLocationRef.current = onSharedLocation;
  }, [onSharedLocation]);

  useEffect(() => {
    onSelectLocationRef.current = onSelectLocation;
    onSelectPlaybackPointRef.current = onSelectPlaybackPoint;
  }, [onSelectLocation, onSelectPlaybackPoint]);

  useEffect(() => {
    let disposed = false;
    let map: import("leaflet").Map | null = null;
    let resizeObserver: ResizeObserver | null = null;

    async function initializeMap() {
      try {
        const leafletModule = await import("leaflet");
        // Patch the same Leaflet singleton before mapReady so Forth GPS clustering is available on first paint.
        await import("leaflet.markercluster");
        const Leaflet = (leafletModule as unknown as { default?: LeafletModule }).default ?? leafletModule;
        if (disposed || !mapNodeRef.current) return;

        map = Leaflet.map(mapNodeRef.current, {
          ...eesLeafletMapInitOptions(),
          scrollWheelZoom: true,
          zoomControl: false,
          // DivIcon vehicle markers stay DOM-based; canvas mode is only for Leaflet vectors.
          preferCanvas: true
        }).setView([13.7563, 100.5018], 11);
        // Guard against any later option merge re-enabling animated zoom (basemap drift).
        map.options.zoomAnimation = false;
        map.options.fadeAnimation = false;
        map.options.markerZoomAnimation = false;
        Leaflet.control.zoom({ position: "bottomright" }).addTo(map);
        map.attributionControl?.setPrefix(false);
        map.attributionControl?.addAttribution(eesLeafletAttributionHtml());
        map.getPane("tilePane")?.style.setProperty("z-index", "200");
        if (!map.getPane(FORTH_GPS_MAP_PANE)) {
          map.createPane(FORTH_GPS_MAP_PANE);
        }
        map.getPane(FORTH_GPS_MAP_PANE)?.style.setProperty("z-index", "480");
        map.getPane("markerPane")?.style.setProperty("z-index", "650");

        // Basemap is attached once. Forth polling refreshes markers only — it does not recreate the map or re-request the whole tile set.
        const basemap = await attachEesLeafletBasemap(Leaflet, map);
        let consecutiveTileFailures = 0;
        basemap.on?.("load", () => { consecutiveTileFailures = 0; setMapTilesUnavailable(false); });
        basemap.on?.("tileload", () => { consecutiveTileFailures = 0; setMapTilesUnavailable(false); });
        basemap.on?.("tileerror", () => {
          consecutiveTileFailures += 1;
          if (consecutiveTileFailures >= 3) setMapTilesUnavailable(true);
        });
        // MapLibre style errors surface asynchronously; keep vehicle markers usable either way.
        const maplibreMap = typeof (basemap as { getMaplibreMap?: () => { on: (event: string, handler: () => void) => void } }).getMaplibreMap === "function"
          ? (basemap as { getMaplibreMap: () => { on: (event: string, handler: () => void) => void } }).getMaplibreMap()
          : null;
        maplibreMap?.on("load", () => { consecutiveTileFailures = 0; setMapTilesUnavailable(false); });
        maplibreMap?.on("error", () => {
          consecutiveTileFailures += 1;
          if (consecutiveTileFailures >= 2) setMapTilesUnavailable(true);
        });
        mapRef.current = map;
        leafletRef.current = Leaflet;
        const previewTooltip = Leaflet.tooltip({
          className: `${styles.vehicleHoverTooltip} leaflet-tooltip`,
          direction: "top",
          offset: [0, -16],
          opacity: 1,
          interactive: false,
          permanent: false,
          sticky: false
        });
        let openHoverKey: string | null = null;
        const hoverIntent = createForthHoverIntent((key) => {
          const entry = markersByKeyRef.current.get(key);
          if (!entry?.onMap || !entry.preview || (screenOverlapKeysRef.current.get(key)?.length ?? 0) > 1) return;
          openHoverKey = key;
          previewTooltip.setContent(entry.preview).setLatLng(entry.marker.getLatLng()).addTo(map!);
        }, () => {
          openHoverKey = null;
          previewTooltip.remove();
        });
        hoverIntentRef.current = hoverIntent;
        refreshOpenHoverRef.current = (key: string) => {
          if (openHoverKey !== key) return;
          const entry = markersByKeyRef.current.get(key);
          if (!entry?.onMap || !entry.preview || (screenOverlapKeysRef.current.get(key)?.length ?? 0) > 1) {
            hoverIntent.dismiss();
            return;
          }
          previewTooltip.setContent(entry.preview).setLatLng(entry.marker.getLatLng());
        };
        map.on("movestart zoomstart", hoverIntent.dismiss);

        const updateMarkerLabels = () => {
          const currentMap = mapRef.current;
          if (!currentMap) return;
          const emphasized = new Set(emphasizedKeysRef.current);
          const candidates = Array.from(markersByKeyRef.current.entries()).flatMap(([key, entry]) => {
            if (!entry.onMap) return [];
            const markerElement = entry.marker.getElement();
            const label = markerElement?.querySelector<HTMLElement>(`.${styles.vehicleMarkerLabel}`);
            if (!label) return [];
            const point = currentMap.latLngToContainerPoint(entry.marker.getLatLng());
            const labelWidth = label.offsetWidth || Math.min(150, 16 + entry.title.length * 7);
            const reveal = emphasized.has(key);
            // V6.3: when a search or list filter matches vehicles, fade the others so the match is visible on the map.
            // Nothing is hidden or made unclickable, and the selected vehicle is never faded.
            if (markerElement) markerElement.style.opacity = emphasized.size > 0 && !reveal && !entry.selected ? "0.3" : "";
            return [{
              key,
              label,
              anchor: point,
              placement: {
                key,
                x: point.x,
                y: point.y,
                iconSize: forthMarkerDiscPxForZoom(currentMap.getZoom()),
                labelWidth,
                labelHeight: label.offsetHeight || 28,
                selected: entry.selected,
                reveal,
                priority: reveal ? 3 : entry.activity === "driving" ? 2 : entry.activity.startsWith("stopped_") ? 1 : 0
              }
            }];
          });
          // Registration text may shift around an anchor; the Leaflet icon and Forth
          // latitude/longitude never shift. Unplaced labels remain accessible by click.
          const size = currentMap.getSize();
          const planned = new Map(planForthMarkerLabels(candidates.map(({ placement }) => placement), { width: size.x, height: size.y }, currentMap.getZoom()).map((item) => [item.key, item]));
          let readableRegistrationCount = 0;
          for (const candidate of candidates) {
            const position = planned.get(candidate.key);
            if (!position) continue;
            const radius = forthMarkerDiscPxForZoom(currentMap.getZoom()) / 2;
            const labelOnLeft = position.left + candidate.placement.labelWidth / 2 < candidate.anchor.x;
            candidate.label.style.left = `${position.left - candidate.anchor.x + radius}px`;
            candidate.label.style.right = "auto";
            candidate.label.style.top = `${position.top - candidate.anchor.y + radius}px`;
            candidate.label.classList.toggle(styles.vehicleMarkerLabelLeft, labelOnLeft);
            // Keep every on-screen registration readable — depot / Bangkok stacks
            // fan labels instead of hiding stopped vehicles under driving ones.
            const readable = position.visible;
            candidate.label.classList.toggle(styles.vehicleMarkerLabelHidden, !readable);
            if (readable) readableRegistrationCount += 1;
          }
          for (const stack of stackMarkersRef.current.values()) {
            const label = stack.marker.getElement()?.querySelector(`.${styles.vehicleMarkerLabel}`);
            if (!label) continue;
            const point = currentMap.latLngToContainerPoint(stack.marker.getLatLng());
            if (point.x >= 0 && point.y >= 0 && point.x <= size.x && point.y <= size.y) readableRegistrationCount += 1;
          }
          const coverage = coverageRef.current;
          if (coverage && coverage.readableRegistrationCount !== readableRegistrationCount) {
            const next = { ...coverage, readableRegistrationCount };
            coverageRef.current = next;
            onMarkerCoverageRef.current?.(next);
          }
        };
        labelUpdateRef.current = updateMarkerLabels;

        const updateSpatialPresentation = () => {
          const currentMap = mapRef.current;
          if (!currentMap || !leafletRef.current) return;
          const currentLeaflet = leafletRef.current;
          // Keep every vehicle marker visible. Do not replace individuals with
          // numbered stack badges — operators must see each reported position.
          for (const [, stack] of stackMarkersRef.current) stack.marker.remove();
          stackMarkersRef.current.clear();

          const points = [...markersByKeyRef.current.entries()].map(([key, entry]) => {
            const position = entry.marker.getLatLng();
            return { key, latitude: position.lat, longitude: position.lng };
          });
          // Exact shared yards only (sub-metre). Used for coverage diagnostics,
          // never to hide markers.
          const sharedGroups = getForthSharedLocationGroups(points, 0.75);

          const zoom = currentMap.getZoom();
          const nextDiscPx = forthMarkerDiscPxForZoom(zoom);
          const discTierChanged = markerDiscPxRef.current !== nextDiscPx;
          markerDiscPxRef.current = nextDiscPx;
          for (const [, entry] of markersByKeyRef.current) {
            if (!entry.onMap) {
              entry.marker.addTo(currentMap);
              entry.onMap = true;
            }
            // Refresh disc size when zoom tier changes so coastal markers do not paint over water.
            if (discTierChanged && entry.onMap) {
              entry.marker.setIcon(markerIcon(currentLeaflet, entry.activity, entry.selected, entry.approximate, entry.offline, entry.title, entry.vehicleClass, entry.make, false, zoom, entry.overlapCount));
            }
          }

          const viewportSize = currentMap.getSize();
          const overlapPoints = [...markersByKeyRef.current.entries()].flatMap(([key, entry]) => {
            if (!entry.onMap) return [];
            const point = currentMap.latLngToContainerPoint(entry.marker.getLatLng());
            if (point.x < 0 || point.y < 0 || point.x > viewportSize.x || point.y > viewportSize.y) return [];
            return [{ key, x: point.x, y: point.y }];
          });
          // Slightly tighter than the disc so nearby but distinct Forth positions
          // stay independently clickable at regional zoom.
          const overlapGroups = getForthScreenOverlapGroups(overlapPoints, Math.max(10, nextDiscPx * 0.55));
          screenOverlapKeysRef.current = new Map(overlapGroups.flatMap((keys) => keys.map((key) => [key, keys] as const)));
          const overlapCounts = new Map<string, number>();
          for (const keys of overlapGroups) {
            for (const key of keys) overlapCounts.set(key, keys.length);
          }
          for (const [key, entry] of markersByKeyRef.current) {
            const overlapCount = overlapCounts.get(key) ?? 1;
            if (entry.overlapCount === overlapCount && !discTierChanged) continue;
            entry.overlapCount = overlapCount;
            entry.marker.setIcon(markerIcon(currentLeaflet, entry.activity, entry.selected, entry.approximate, entry.offline, entry.title, entry.vehicleClass, entry.make, false, zoom, overlapCount > 1 ? overlapCount : 1));
            entry.marker.setZIndexOffset(entry.selected ? 1200 : entry.activity === "driving" ? 700 : overlapCount > 1 ? 500 : 0);
            if (overlapCount > 1) {
              entry.marker.getElement()?.setAttribute("aria-label", `${entry.title} · ${overlapCount} vehicles near this map position; choose to select`);
            }
          }

          const represented = new Set<string>();
          let symbolCount = 0;
          for (const [key, entry] of markersByKeyRef.current) {
            if (entry.onMap && entry.marker.getElement()) { represented.add(key); symbolCount++; }
          }
          const screenOverlapCount = overlapGroups.reduce((count, keys) => count + keys.length - 1, 0);
          const sharedPositionCount = sharedGroups.reduce((count, keys) => count + keys.length - 1, 0);
          const vehicleKeys = [...represented].sort();
          const coverageSignature = `${vehicleKeys.join("\u0000")}|${symbolCount}|${screenOverlapCount}|${sharedPositionCount}`;
          if (lastMarkerCoverageRef.current !== coverageSignature) {
            lastMarkerCoverageRef.current = coverageSignature;
            const coverage = { vehicleKeys, symbolCount, readableRegistrationCount: coverageRef.current?.readableRegistrationCount ?? 0, screenOverlapCount, sharedPositionCount };
            coverageRef.current = coverage;
            onMarkerCoverageRef.current?.(coverage);
          }

          window.requestAnimationFrame(() => labelUpdateRef.current());
        };
        spatialUpdateRef.current = updateSpatialPresentation;

        map.on("zoomend", updateSpatialPresentation);
        map.on("moveend", updateSpatialPresentation);
        map.on("resize", updateSpatialPresentation);

        if (mapNodeRef.current && typeof ResizeObserver !== "undefined") {
          resizeObserver = new ResizeObserver(() => {
            window.requestAnimationFrame(() => map?.invalidateSize({ pan: false }));
          });
          resizeObserver.observe(mapNodeRef.current);
        }
        setMapReady(true);
        window.requestAnimationFrame(() => map?.invalidateSize({ pan: false }));
      } catch {
        if (!disposed) setMapFailed(true);
      }
    }

    const markers = markersByKeyRef.current;
    const stacks = stackMarkersRef.current;
    const locationMarkers = locationMarkersRef.current;
    const forthGpsMarkers = forthGpsMarkersRef.current;
    void initializeMap();
    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      hoverIntentRef.current?.dismiss();
      hoverIntentRef.current = null;
      refreshOpenHoverRef.current = () => undefined;
      map?.remove();
      mapRef.current = null;
      labelUpdateRef.current = () => undefined;
      spatialUpdateRef.current = () => undefined;
      markers.clear();
      stacks.clear();
      locationMarkers.forEach((marker) => {
        try { marker.remove(); } catch { /* map gone */ }
      });
      locationMarkers.clear();
      forthGpsClusterRef.current = null;
      forthGpsMarkers.clear();
      coverageRef.current = null;
      lastMarkerCoverageRef.current = "";
      leafletRef.current = null;
      initialFitCompleteRef.current = false;
      // Force dependent paint effects to re-run after Strict Mode / remount creates a new map.
      setMapReady(false);
    };
  }, []);

  // Keep original Leaflet markers and their Forth coordinates stable across polling.
  // Routine polling does not pan or zoom the map — only explicit view commands move the camera.
  useEffect(() => {
    const map = mapRef.current;
    const Leaflet = leafletRef.current;
    if (!mapReady || !map || !Leaflet) return;

    const currentKeys = new Set(positionedRecords.map(({ key }) => key));
    for (const [key, entry] of markersByKeyRef.current) {
      if (currentKeys.has(key)) continue;
      entry.marker.remove();
      markersByKeyRef.current.delete(key);
    }

    for (const { record, key, position } of positionedRecords) {
      const activity = getForthReportedActivity(record);
      const identity = getForthTrackingVehicleIdentity(record.vehicleRegistration);
      const approximate = !isForthGpsPositionVerified(record);
      const offline = record.gprsConnectivity === "disconnected";
      const markerTitle = record.vehicleRegistration || record.gpsDeviceId || copy.unknownValue;
      const confidenceLabel = approximate ? copy.notGpsVerified : copy.gpsVerified;
      const confirmedDriver = confirmedDriverFor?.(record) ?? null;
      const tooltipSignature = [markerTitle, activityLabel(activity, copy), confidenceLabel, confirmedDriver, record.reportedDriver, record.speed, record.engineOn, getForthLocationArea(record, language), record.lastGpsTimestamp, language].join("\u0000");
      const zoom = map.getZoom();
      let entry = markersByKeyRef.current.get(key);
      if (!entry) {
        const selected = key === selectedKeyRef.current;
        const marker = Leaflet.marker(position, {
          icon: markerIcon(Leaflet, activity, selected, approximate, offline, markerTitle, identity.vehicleClass, identity.make, false, zoom),
          title: "",
          alt: `${markerTitle} · ${confidenceLabel}`,
          zIndexOffset: selected ? 1200 : 0,
          keyboard: true,
          riseOnHover: false
        }).addTo(map);
        marker.on("click", () => {
          hoverIntentRef.current?.dismiss();
          const overlapKeys = screenOverlapKeysRef.current.get(key);
          if (overlapKeys && overlapKeys.length > 1) {
            onSharedLocationRef.current?.(overlapKeys, "map_overlap");
            return;
          }
          onSelectRef.current(key);
        });
        // mouseover/out fire when crossing icon↔label; ignore moves that stay inside the marker.
        marker.on("mouseover", () => {
          if ((screenOverlapKeysRef.current.get(key)?.length ?? 0) > 1) hoverIntentRef.current?.dismiss();
          else hoverIntentRef.current?.enter(key);
        });
        marker.on("mouseout", (event: { originalEvent?: MouseEvent }) => {
          const root = marker.getElement();
          const next = event.originalEvent?.relatedTarget;
          if (root && next instanceof Node && root.contains(next)) return;
          hoverIntentRef.current?.leave(key);
        });
        marker.on("focus", () => {
          if ((screenOverlapKeysRef.current.get(key)?.length ?? 0) > 1) hoverIntentRef.current?.dismiss();
          else hoverIntentRef.current?.focus(key);
        });
        marker.on("blur", () => hoverIntentRef.current?.leave(key));
        entry = { marker, activity, approximate, offline, selected, title: markerTitle, vehicleClass: identity.vehicleClass, make: identity.make, tooltipSignature: "", preview: null, onMap: true, overlapCount: 1 };
        markersByKeyRef.current.set(key, entry);
        marker.getElement()?.setAttribute("aria-label", `${markerTitle} · ${confidenceLabel}`);
        marker.getElement()?.removeAttribute("title");
      } else {
        const previousPosition = entry.marker.getLatLng();
        if (previousPosition.lat !== position[0] || previousPosition.lng !== position[1]) entry.marker.setLatLng(position);
        const changed = entry.activity !== activity || entry.approximate !== approximate || entry.offline !== offline || entry.vehicleClass !== identity.vehicleClass || entry.make !== identity.make || entry.title !== markerTitle;
        if (changed) {
          entry.activity = activity;
          entry.approximate = approximate;
          entry.offline = offline;
          entry.vehicleClass = identity.vehicleClass;
          entry.make = identity.make;
          entry.title = markerTitle;
          entry.marker.setIcon(markerIcon(Leaflet, activity, entry.selected, approximate, offline, markerTitle, identity.vehicleClass, identity.make, false, zoom, entry.overlapCount));
          entry.marker.options.title = "";
          entry.marker.options.alt = `${markerTitle} · ${confidenceLabel}`;
          entry.marker.getElement()?.setAttribute("aria-label", `${markerTitle} · ${confidenceLabel}`);
          entry.marker.getElement()?.removeAttribute("title");
        }
      }

      if (entry.tooltipSignature !== tooltipSignature) {
        entry.preview = quickView(record, markerTitle, activity, confidenceLabel, copy, language, confirmedDriver);
        entry.tooltipSignature = tooltipSignature;
        refreshOpenHoverRef.current(key);
      }
    }

    spatialUpdateRef.current();
  }, [copy, language, mapReady, positionedRecords, confirmedDriverFor]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !onViewportKeys) return;
    const publish = () => {
      const bounds = map.getBounds();
      onViewportKeys(positionedRecords.filter(({ position }) => bounds.contains(position)).map(({ key }) => key));
    };
    publish();
    map.on("moveend zoomend resize", publish);
    return () => { map.off("moveend zoomend resize", publish); };
  }, [mapReady, onViewportKeys, positionedRecords]);

  // Office-confirmed Directory pins (diamond) — separate from Forth GPS cluster layer.
  useEffect(() => {
    const map = mapRef.current;
    const Leaflet = leafletRef.current;
    if (!mapReady || !map || !Leaflet) return;
    const active = new Set<string>();
    if (locationsVisible) {
      for (const location of directoryLocations) {
        active.add(location.id);
        const selected = location.id === selectedLocationId;
        const title = `${location.companyName} · ${location.category} · office confirmed`;
        let marker = locationMarkersRef.current.get(location.id);
        if (!marker) {
          marker = Leaflet.marker([location.latitude, location.longitude], {
            icon: locationPinIcon(Leaflet, location.category, selected),
            title,
            alt: title,
            zIndexOffset: selected ? 900 : 200,
            keyboard: true,
            riseOnHover: true
          }).addTo(map);
          const locationId = location.id;
          marker.on("click", () => onSelectLocationRef.current?.(locationId));
          locationMarkersRef.current.set(location.id, marker);
        } else {
          const previous = marker.getLatLng();
          if (previous.lat !== location.latitude || previous.lng !== location.longitude) {
            marker.setLatLng([location.latitude, location.longitude]);
          }
          marker.setIcon(locationPinIcon(Leaflet, location.category, selected));
          marker.setZIndexOffset(selected ? 900 : 200);
          marker.options.title = title;
          marker.options.alt = title;
        }
      }
    }
    for (const [id, marker] of locationMarkersRef.current) {
      if (active.has(id)) continue;
      marker.remove();
      locationMarkersRef.current.delete(id);
    }
  }, [directoryLocations, locationsVisible, mapReady, selectedLocationId]);

  // Forth GPS saved destinations — clustered for performance; visible even when live fleet GPS fails.
  useEffect(() => {
    const map = mapRef.current;
    const Leaflet = leafletRef.current;
    if (!mapReady || !map || !Leaflet) return;

    type ClusterLike = import("leaflet").LayerGroup & {
      clearLayers: () => void;
      addLayer: (layer: import("leaflet").Layer) => void;
    };

    const withCluster = Leaflet as LeafletModule & {
      markerClusterGroup?: (options?: Record<string, unknown>) => ClusterLike;
    };

    if (forthGpsClusterSchemaRef.current !== FORTH_GPS_CLUSTER_SCHEMA && forthGpsClusterRef.current) {
      try { map.removeLayer(forthGpsClusterRef.current as import("leaflet").Layer); } catch { /* map updating */ }
      forthGpsClusterRef.current = null;
    }
    forthGpsClusterSchemaRef.current = FORTH_GPS_CLUSTER_SCHEMA;

    let cluster: ClusterLike;
    if (forthGpsClusterRef.current && map.hasLayer(forthGpsClusterRef.current as import("leaflet").Layer)) {
      cluster = forthGpsClusterRef.current as ClusterLike;
    } else {
      if (forthGpsClusterRef.current) {
        try { map.removeLayer(forthGpsClusterRef.current as import("leaflet").Layer); } catch { /* orphaned */ }
      }
      cluster = typeof withCluster.markerClusterGroup === "function"
        ? withCluster.markerClusterGroup({
          maxClusterRadius: forthGpsClusterMaxRadius,
          disableClusteringAtZoom: forthGpsDisableClusteringAtZoom(),
          classNamePrefix: "forth-gps-cluster",
          iconCreateFunction: (childCluster: ForthGpsClusterLike) => forthGpsClusterIconCreateFunction(Leaflet, childCluster),
          clusterPane: FORTH_GPS_MAP_PANE,
          showCoverageOnHover: false,
          spiderfyOnMaxZoom: true,
          zoomToBoundsOnClick: true,
          spiderfyDistanceMultiplier: 1.65,
          removeOutsideVisibleBounds: true,
          animate: false
        })
        : (Leaflet.layerGroup() as ClusterLike);
      cluster.addTo(map);
      forthGpsClusterRef.current = cluster;
    }

    for (const marker of forthGpsMarkersRef.current.values()) {
      try { marker.remove(); } catch { /* map updating */ }
    }
    cluster.clearLayers();
    forthGpsMarkersRef.current.clear();
    if (!locationsVisible || forthGpsLocations.length === 0) return;

    // Single focused destination: paint directly (no cluster badge). Full layer uses clustering.
    const useDirectPins = forthGpsLocations.length === 1;
    for (const location of forthGpsLocations) {
      const selected = location.id === selectedLocationId;
      const title = `${location.name} · Forth GPS · ${location.forthLocationId}`;
      const marker = Leaflet.marker([location.latitude, location.longitude], {
        icon: forthGpsPinIcon(Leaflet, selected, Boolean(location.matchedEesLocationId)),
        pane: FORTH_GPS_MAP_PANE,
        title,
        alt: title,
        keyboard: true,
        riseOnHover: true,
        zIndexOffset: selected ? 420 : 0
      });
      const locationId = location.id;
      marker.on("click", () => onSelectLocationRef.current?.(locationId));
      if (useDirectPins) marker.addTo(map);
      else cluster.addLayer(marker);
      forthGpsMarkersRef.current.set(location.id, marker);
    }
  }, [forthGpsLocations, locationsVisible, mapReady, selectedLocationId]);

  // Historical journey path — amber reported trail, purple only for verified GPS continuity.
  useEffect(() => {
    const map = mapRef.current;
    const Leaflet = leafletRef.current;
    if (!mapReady || !map || !Leaflet) return;
    if (!playbackLayerRef.current) {
      playbackLayerRef.current = Leaflet.layerGroup().addTo(map);
    }
    const group = playbackLayerRef.current;
    group.clearLayers();
    if (!playback?.active || !playback.points.length) { playbackFitKeyRef.current = null; return; }

    const framePositions = playback.points
      .filter((point) => point.latitude != null && point.longitude != null)
      .map((point) => [point.latitude as number, point.longitude as number] as [number, number]);
    const fitKey = `${playback.registration ?? ""}|${framePositions.length}|${framePositions[0]?.join(",") ?? ""}|${framePositions.at(-1)?.join(",") ?? ""}`;
    if (framePositions.length > 0 && playbackFitKeyRef.current !== fitKey) {
      playbackFitKeyRef.current = fitKey;
      frameJourneyCamera(map, Leaflet, framePositions);
    }

    const byIndex = new Map(playback.points.map((point) => [point.index, point]));
    const verifiedKeys = new Set(playback.segments.map((segment) => `${segment.fromIndex}:${segment.toIndex}`));
    // Consecutive reported segments are joined into one polyline per run (a break is a gap, a verified segment or a
    // missing coordinate). Only recorded points are joined; nothing is interpolated across a gap.
    let run: [number, number][] = [];
    let runEnd = -1;
    const flushRun = () => {
      if (run.length > 1) Leaflet.polyline(run, { color: "#b45309", weight: 3, opacity: 0.7, dashArray: "6 8", className: styles.playbackPath }).addTo(group);
      run = [];
      runEnd = -1;
    };
    for (const segment of playback.reportedTrailSegments ?? []) {
      const a = byIndex.get(segment.fromIndex);
      const b = byIndex.get(segment.toIndex);
      if (
        verifiedKeys.has(`${segment.fromIndex}:${segment.toIndex}`) ||
        !(a?.trailEligible || a?.verifiedGps) ||
        !(b?.trailEligible || b?.verifiedGps) ||
        a.latitude == null ||
        a.longitude == null ||
        b.latitude == null ||
        b.longitude == null
      ) {
        flushRun();
        continue;
      }
      if (run.length && runEnd !== segment.fromIndex) flushRun();
      if (!run.length) run.push([a.latitude, a.longitude]);
      run.push([b.latitude, b.longitude]);
      runEnd = segment.toIndex;
    }
    flushRun();
    for (const segment of playback.segments) {
      const a = byIndex.get(segment.fromIndex);
      const b = byIndex.get(segment.toIndex);
      if (!a?.verifiedGps || !b?.verifiedGps || a.latitude == null || a.longitude == null || b.latitude == null || b.longitude == null) continue;
      Leaflet.polyline(
        [[a.latitude, a.longitude], [b.latitude, b.longitude]],
        { color: "#5b21b6", weight: 4, opacity: 0.88, dashArray: undefined, className: styles.playbackPath }
      ).addTo(group);
    }

    // Long days: draw every Nth recorded point (always the first, last, cursor, verified and gap-edge points).
    const dotStride = Math.max(1, Math.ceil(playback.points.length / 250));
    for (const [position, point] of playback.points.entries()) {
      if (point.latitude == null || point.longitude == null) continue;
      const selected = point.index === playback.cursorIndex;
      if (!selected && !point.verifiedGps && !point.isGapEdge && position !== 0 && position !== playback.points.length - 1 && position % dotStride !== 0) continue;
      const color = point.verifiedGps ? (selected ? "#4c1d95" : "#7c3aed") : "#d97706";
      const marker = Leaflet.circleMarker([point.latitude, point.longitude], {
        radius: selected ? 8 : point.isGapEdge ? 6 : 4,
        color: "#fff",
        weight: selected ? 2.5 : 1.5,
        fillColor: color,
        fillOpacity: point.verifiedGps ? 0.95 : 0.55,
        className: styles.playbackPoint
      });
      const index = point.index;
      marker.on("click", () => onSelectPlaybackPointRef.current?.(index));
      marker.addTo(group);
    }

    const cursor = byIndex.get(playback.cursorIndex);
    if (cursor?.latitude != null && cursor.longitude != null) {
      const label = escapeHtml(playback.registration ?? "Playback");
      Leaflet.marker([cursor.latitude, cursor.longitude], {
        interactive: false,
        zIndexOffset: 1500,
        icon: Leaflet.divIcon({
          className: styles.playbackCursor,
          html: `<span class="${styles.playbackCursorDot}"></span><span class="${styles.playbackCursorLabel}"><strong>${label}</strong><em>PLAYBACK</em></span>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14]
        })
      }).addTo(group);
    }
  }, [mapReady, playback]);

  // Fit once to Thailand Core Operations — do not wait for live vehicles (avoids Asia-wide empty map).
  useEffect(() => {
    const map = mapRef.current;
    const Leaflet = leafletRef.current;
    if (!mapReady || !map || !Leaflet || initialFitCompleteRef.current) return;
    map.fitBounds(Leaflet.latLngBounds(FORTH_BANGKOK_OPS_BOUNDS), {
      padding: [40, 40],
      maxZoom: FORTH_BANGKOK_OPS_ZOOM,
      animate: false
    });
    if (map.getZoom() < 8) map.setView(FORTH_BANGKOK_OPS_CENTER, FORTH_BANGKOK_OPS_ZOOM, { animate: false });
    initialFitCompleteRef.current = true;
  }, [mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    const Leaflet = leafletRef.current;
    if (!mapReady || !map || !Leaflet || command.sequence === 0 || command.sequence === lastCommandSequenceRef.current) return;
    if (applyForthMapViewCommand(
      map,
      Leaflet,
      command,
      positionedRecords.map(({ position }) => position),
      markersByKeyRef.current,
      Boolean(selectedKeyRef.current),
      framingPositions
    )) lastCommandSequenceRef.current = command.sequence;
  }, [command, framingPositions, mapReady, positionedRecords]);

  useEffect(() => {
    if (lastFilterKeyRef.current === filterKey) return;
    lastFilterKeyRef.current = filterKey;
    spatialUpdateRef.current();
  }, [filterKey, mapReady]);

  useEffect(() => {
    emphasizedKeysRef.current = emphasizedKeys;
    spatialUpdateRef.current();
    window.requestAnimationFrame(() => labelUpdateRef.current());
  }, [emphasizedKeys, mapReady]);

  useEffect(() => {
    const Leaflet = leafletRef.current;
    if (!mapReady || !Leaflet) return;
    hoverIntentRef.current?.dismiss();
    const previousSelectedKey = lastSelectedKeyRef.current;
    for (const key of new Set([previousSelectedKey, selectedKey])) {
      const entry = key ? markersByKeyRef.current.get(key) : undefined;
      if (!entry) continue;
      const selected = key === selectedKey;
      if (entry.selected !== selected) {
        entry.selected = selected;
        entry.marker.setIcon(markerIcon(Leaflet, entry.activity, selected, entry.approximate, entry.offline, entry.title, entry.vehicleClass, entry.make, false, mapRef.current?.getZoom() ?? 14, entry.overlapCount));
        entry.marker.setZIndexOffset(selected ? 1200 : entry.overlapCount > 1 ? 500 : 0);
      }
    }
    lastSelectedKeyRef.current = selectedKey;
    spatialUpdateRef.current();
    window.requestAnimationFrame(() => labelUpdateRef.current());
  }, [mapReady, selectedKey]);

  return (
    <div className={styles.mapFrame} role="region" aria-label={copy.mapRegionLabel} data-map-language={language}>
      <div ref={mapNodeRef} className={styles.mapCanvas} />
      {!mapReady && !mapFailed ? <div className={styles.mapNotice} role="status">{copy.loading}</div> : null}
      {mapFailed ? <div className={styles.mapNotice} role="alert">{copy.mapUnavailable}</div> : null}
      {mapReady && mapTilesUnavailable ? <div className={styles.mapTileNotice} role="status">{language === "th" ? "พื้นหลังแผนที่ยังโหลดไม่ได้ ตำแหน่งรถและข้อมูลในรายการยังคงเป็นพิกัดที่รายงานจาก Forth" : "Map background temporarily unavailable. Vehicle positions and the Fleet Monitor still use Forth-reported coordinates."}</div> : null}
      {mapReady && announceEmpty && positionedRecords.length === 0 ? <div className={styles.mapNotice} role="status">{copy.noPositions}</div> : null}
    </div>
  );
});
