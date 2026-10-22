"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import styles from "./forth-tracking-map.module.css";
import {
  getForthFleetMapRecords,
  getForthReportedActivity,
  isForthGpsPositionVerified,
  formatForthTrackingTime,
  type ForthReportedActivity
} from "@/lib/forth-tracking-view";
import type { ForthFleetTrackingRecord } from "@/lib/forth-tracking-server";

type Copy = {
  driving: string;
  stopped: string;
  unavailable: string;
  gpsVerified: string;
  notGpsVerified: string;
  speed: string;
  engine: string;
  engineOn: string;
  engineOff: string;
  unknownValue: string;
  gpsQuality: string;
  noGpsQuality: string;
  wifiQuality: string;
  lbsQuality: string;
  otherQuality: string;
  unknownQuality: string;
  current: string;
  stale: string;
  noPositions: string;
  loading: string;
  mapUnavailable: string;
  mapRegionLabel: string;
  lastVehicleUpdate: string;
  openDetails: string;
};

type ViewCommand = { type: "fit" | "focus"; sequence: number; key?: string | null };

type Props = {
  records: ForthFleetTrackingRecord[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  command: ViewCommand;
  language: "en" | "th";
  copy: Copy;
};

type LeafletModule = typeof import("leaflet");
type FleetMarker = import("leaflet").Marker;

const tileUrl = process.env.NEXT_PUBLIC_EES_MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

function activityLabel(activity: ForthReportedActivity, copy: Copy) {
  if (activity === "driving") return copy.driving;
  if (activity === "stopped_engine_on") return copy.stopped + " · " + copy.engineOn;
  if (activity === "stopped_engine_off") return copy.stopped + " · " + copy.engineOff;
  if (activity === "stopped_engine_unknown") return copy.stopped + " · " + copy.unknownValue;
  return copy.unavailable;
}

function positionQualityLabel(record: ForthFleetTrackingRecord, copy: Copy) {
  if (record.positionQuality === "gps") return copy.gpsQuality;
  if (record.positionQuality === "no_gps") return copy.noGpsQuality;
  if (record.positionQuality === "wifi") return copy.wifiQuality;
  if (record.positionQuality === "lbs") return copy.lbsQuality;
  if (record.positionQuality === "other") return copy.otherQuality;
  return copy.unknownQuality;
}

function markerIcon(
  Leaflet: LeafletModule,
  activity: ForthReportedActivity,
  selected: boolean,
  approximate: boolean,
  offline: boolean
) {
  const statusClass = activity === "driving"
    ? styles.vehicleMarkerDriving
    : activity.startsWith("stopped_")
      ? styles.vehicleMarkerStopped
      : styles.vehicleMarkerUnavailable;
  return Leaflet.divIcon({
    className: styles.vehicleMarker,
    html: "<span class=\"" + styles.vehicleMarkerDot + " " + statusClass +
      (approximate ? " " + styles.vehicleMarkerApproximate : "") +
      (offline ? " " + styles.vehicleMarkerOffline : "") +
      (selected ? " " + styles.vehicleMarkerSelected : "") + "\"></span>",
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -18],
    tooltipAnchor: [0, -18]
  });
}

function fitFleet(map: import("leaflet").Map, Leaflet: LeafletModule, positions: [number, number][]) {
  if (positions.length === 0) return;
  const first = positions[0];
  const allSamePosition = positions.every((position) => position[0] === first[0] && position[1] === first[1]);
  if (positions.length === 1 || allSamePosition) map.setView(first, 13, { animate: true });
  else map.fitBounds(Leaflet.latLngBounds(positions), { padding: [44, 44], maxZoom: 13, animate: true });
}

export function ForthTrackingMap({ records, selectedKey, onSelect, command, language, copy }: Props) {
  const mapNodeRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const markerClusterRef = useRef<import("leaflet").MarkerClusterGroup | null>(null);
  const markersByKeyRef = useRef(new Map<string, { marker: FleetMarker; activity: ForthReportedActivity; approximate: boolean; offline: boolean }>());
  const leafletRef = useRef<LeafletModule | null>(null);
  const onSelectRef = useRef(onSelect);
  const initialFitCompleteRef = useRef(false);
  const lastCommandSequenceRef = useRef(0);
  const [mapReady, setMapReady] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);

  const positionedRecords = useMemo(() => getForthFleetMapRecords(records), [records]);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    let disposed = false;
    let map: import("leaflet").Map | null = null;
    let resizeObserver: ResizeObserver | null = null;

    async function initializeMap() {
      try {
        const leafletModule = await import("leaflet");
        await import("leaflet.markercluster");
        const Leaflet = (leafletModule as unknown as { default?: LeafletModule }).default ?? leafletModule;
        if (disposed || !mapNodeRef.current) return;

        map = Leaflet.map(mapNodeRef.current, {
          minZoom: 4,
          scrollWheelZoom: true,
          zoomControl: true,
          preferCanvas: true
        }).setView([13.7563, 100.5018], 6);
        map.getPane("tilePane")?.style.setProperty("z-index", "200");
        map.getPane("markerPane")?.style.setProperty("z-index", "650");

        Leaflet.tileLayer(tileUrl, {
          maxZoom: 19,
          minZoom: 4,
          keepBuffer: 2,
          updateWhenIdle: true,
          updateWhenZooming: false,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>'
        }).addTo(map);

        mapRef.current = map;
        markerClusterRef.current = Leaflet.markerClusterGroup({
          maxClusterRadius: 42,
          showCoverageOnHover: false,
          spiderfyOnMaxZoom: true,
          zoomToBoundsOnClick: true,
          animate: true
        }).addTo(map);
        leafletRef.current = Leaflet;
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

    void initializeMap();
    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      map?.remove();
      mapRef.current = null;
      markerClusterRef.current = null;
      markersByKeyRef.current.clear();
      leafletRef.current = null;
    };
  }, []);

  // Reconcile markers in place so each 60-second data refresh leaves the map's
  // current pan and zoom untouched and does not recreate the marker layer.
  useEffect(() => {
    const cluster = markerClusterRef.current;
    const Leaflet = leafletRef.current;
    if (!mapReady || !cluster || !Leaflet) return;

    const currentKeys = new Set(positionedRecords.map(({ key }) => key));
    for (const [key, entry] of markersByKeyRef.current) {
      if (currentKeys.has(key)) continue;
      cluster.removeLayer(entry.marker);
      markersByKeyRef.current.delete(key);
    }

    for (const { record, key, position } of positionedRecords) {
      const activity = getForthReportedActivity(record);
      const approximate = !isForthGpsPositionVerified(record);
      const offline = record.gprsConnectivity === "disconnected";
      const markerTitle = record.vehicleRegistration || record.gpsDeviceId || copy.unknownValue;
      let entry = markersByKeyRef.current.get(key);
      if (!entry) {
        const marker = Leaflet.marker(position, {
          icon: markerIcon(Leaflet, activity, key === selectedKey, approximate, offline),
          title: markerTitle,
          alt: markerTitle,
          keyboard: true,
          riseOnHover: true
        });
        marker.on("click", () => onSelectRef.current(key));
        cluster.addLayer(marker);
        entry = { marker, activity, approximate, offline };
        markersByKeyRef.current.set(key, entry);
      } else {
        const previousPosition = entry.marker.getLatLng();
        if (previousPosition.lat !== position[0] || previousPosition.lng !== position[1]) {
          cluster.removeLayer(entry.marker);
          entry.marker.setLatLng(position);
          cluster.addLayer(entry.marker);
        }
        entry.activity = activity;
        entry.approximate = approximate;
        entry.offline = offline;
      }

      entry.marker.setIcon(markerIcon(Leaflet, activity, key === selectedKey, approximate, offline));
      entry.marker.setZIndexOffset(key === selectedKey ? 1200 : 0);

      const content = document.createElement("div");
      content.className = "forth-tracking-popup";
      const title = document.createElement("strong");
      title.textContent = markerTitle;
      const state = document.createElement("span");
      state.textContent = activityLabel(activity, copy);
      const speed = document.createElement("span");
      speed.textContent = copy.speed + ": " + (record.speed === null ? copy.unknownValue : record.speed + " km/h");
      const engine = document.createElement("span");
      engine.textContent = copy.engine + ": " + (record.engineOn === null ? copy.unknownValue : record.engineOn ? copy.engineOn : copy.engineOff);
      const confidence = document.createElement("span");
      confidence.textContent = approximate ? copy.notGpsVerified : copy.gpsVerified;
      const quality = document.createElement("span");
      quality.textContent = positionQualityLabel(record, copy);
      const freshness = document.createElement("span");
      freshness.textContent = record.timestampStatus === "current" ? copy.current : record.timestampStatus === "stale" ? copy.stale : copy.unknownValue;
      const update = document.createElement("span");
      update.textContent = copy.lastVehicleUpdate + ": " + (formatForthTrackingTime(record.lastGpsTimestamp, language) ?? copy.unknownValue);
      const details = document.createElement("button");
      details.type = "button";
      details.className = "forth-tracking-popup-action";
      details.textContent = copy.openDetails;
      details.addEventListener("click", (event) => {
        event.stopPropagation();
        onSelectRef.current(key);
      });
      content.append(title, state, speed, engine, update, confidence, quality, freshness, details);
      if (entry.marker.getPopup()) entry.marker.setPopupContent(content);
      else entry.marker.bindPopup(content, { closeButton: true, autoPanPadding: [24, 24] });

      const tooltip = document.createElement("span");
      tooltip.textContent = markerTitle + " · " + activityLabel(activity, copy) + " · " + (approximate ? copy.notGpsVerified : copy.gpsVerified);
      if (entry.marker.getTooltip()) entry.marker.setTooltipContent(tooltip);
      else entry.marker.bindTooltip(tooltip, { direction: "top", offset: [0, -8], opacity: 0.96 });
    }
  }, [copy, language, mapReady, positionedRecords, selectedKey]);

  // The fleet is fit once after its first usable positions arrive. Later data
  // updates never invoke fitBounds; only an explicit map command can move it.
  useEffect(() => {
    const map = mapRef.current;
    const Leaflet = leafletRef.current;
    if (!mapReady || !map || !Leaflet || initialFitCompleteRef.current || positionedRecords.length === 0) return;
    fitFleet(map, Leaflet, positionedRecords.map(({ position }) => position));
    initialFitCompleteRef.current = true;
  }, [mapReady, positionedRecords]);

  useEffect(() => {
    const map = mapRef.current;
    const cluster = markerClusterRef.current;
    const Leaflet = leafletRef.current;
    if (!mapReady || !map || !cluster || !Leaflet || command.sequence === 0 || command.sequence === lastCommandSequenceRef.current) return;
    lastCommandSequenceRef.current = command.sequence;

    if (command.type === "fit") {
      fitFleet(map, Leaflet, positionedRecords.map(({ position }) => position));
      return;
    }

    if (command.type === "focus" && command.key) {
      const marker = markersByKeyRef.current.get(command.key)?.marker;
      if (!marker) return;
      cluster.zoomToShowLayer(marker, () => {
        const position = marker.getLatLng();
        map.flyTo(position, Math.min(16, Math.max(13, map.getZoom())), { duration: 0.35 });
        marker.openPopup();
      });
    }
  }, [command, mapReady, positionedRecords]);

  useEffect(() => {
    const Leaflet = leafletRef.current;
    if (!mapReady || !Leaflet) return;
    for (const [key, entry] of markersByKeyRef.current) {
      const selected = key === selectedKey;
      entry.marker.setIcon(markerIcon(Leaflet, entry.activity, selected, entry.approximate, entry.offline));
      entry.marker.setZIndexOffset(selected ? 1200 : 0);
    }
  }, [mapReady, selectedKey]);

  return (
    <div className={styles.mapFrame} role="region" aria-label={copy.mapRegionLabel} data-map-language={language}>
      <div ref={mapNodeRef} className={styles.mapCanvas} />
      {!mapReady && !mapFailed ? (
        <div className={styles.mapNotice} role="status">{copy.loading}</div>
      ) : null}
      {mapFailed ? (
        <div className={styles.mapNotice} role="alert">{copy.mapUnavailable}</div>
      ) : null}
      {mapReady && positionedRecords.length === 0 ? (
        <div className={styles.mapNotice} role="status">{copy.noPositions}</div>
      ) : null}
    </div>
  );
}
