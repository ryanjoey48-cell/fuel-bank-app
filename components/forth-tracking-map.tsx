"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import styles from "./forth-tracking-map.module.css";
import {
  getForthFleetMapRecords,
  getForthReportedActivity,
  isForthGpsPositionVerified,
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
};

type Props = {
  records: ForthFleetTrackingRecord[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  language: "en" | "th";
  copy: Copy;
};

type LeafletModule = typeof import("leaflet");

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

function markerIcon(Leaflet: LeafletModule, activity: ForthReportedActivity, selected: boolean, approximate: boolean) {
  const statusClass = activity === "driving"
    ? styles.vehicleMarkerDriving
    : activity.startsWith("stopped_")
      ? styles.vehicleMarkerStopped
      : styles.vehicleMarkerUnavailable;
  return Leaflet.divIcon({
    className: styles.vehicleMarker,
    html: "<span class=\"" + styles.vehicleMarkerDot + " " + statusClass +
      (approximate ? " " + styles.vehicleMarkerApproximate : "") +
      (selected ? " " + styles.vehicleMarkerSelected : "") + "\"></span>",
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -16],
    tooltipAnchor: [0, -16]
  });
}

export function ForthTrackingMap({ records, selectedKey, onSelect, language, copy }: Props) {
  const mapNodeRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const markerLayerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const markersByKeyRef = useRef(new Map<string, { marker: import("leaflet").Marker; activity: ForthReportedActivity; approximate: boolean }>());
  const leafletRef = useRef<LeafletModule | null>(null);
  const onSelectRef = useRef(onSelect);
  const fittedBoundsRef = useRef(false);
  const lastPannedSelectionRef = useRef<{ key: string; latitude: number; longitude: number } | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);

  const positionedRecords = useMemo(() => getForthFleetMapRecords(records), [records]);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    let disposed = false;
    let map: import("leaflet").Map | null = null;

    async function initializeMap() {
      try {
        const leafletModule = await import("leaflet");
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
        markerLayerRef.current = Leaflet.layerGroup().addTo(map);
        leafletRef.current = Leaflet;
        setMapReady(true);
        window.requestAnimationFrame(() => map?.invalidateSize());
      } catch {
        if (!disposed) setMapFailed(true);
      }
    }

    void initializeMap();
    return () => {
      disposed = true;
      map?.remove();
      mapRef.current = null;
      markerLayerRef.current = null;
      markersByKeyRef.current.clear();
      leafletRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const markerLayer = markerLayerRef.current;
    const Leaflet = leafletRef.current;
    if (!mapReady || !map || !markerLayer || !Leaflet) return;

    markerLayer.clearLayers();
    markersByKeyRef.current.clear();
    const bounds: [number, number][] = [];

    for (const { record, key, position } of positionedRecords) {
      const activity = getForthReportedActivity(record);
      const gpsVerified = isForthGpsPositionVerified(record);
      const approximate = !gpsVerified;
      const markerTitle = record.vehicleRegistration || record.gpsDeviceId || copy.unknownValue;
      const marker = Leaflet.marker(position, {
        icon: markerIcon(Leaflet, activity, false, approximate),
        title: markerTitle,
        alt: markerTitle,
        keyboard: true,
        riseOnHover: true
      });
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
      confidence.textContent = gpsVerified ? copy.gpsVerified : copy.notGpsVerified;
      const quality = document.createElement("span");
      quality.textContent = positionQualityLabel(record, copy);
      const freshness = document.createElement("span");
      freshness.textContent = record.timestampStatus === "current" ? copy.current : record.timestampStatus === "stale" ? copy.stale : copy.unknownValue;
      content.append(title, state, speed, engine, confidence, quality, freshness);
      marker.bindPopup(content, { closeButton: true, autoPanPadding: [24, 24] });
      const tooltip = document.createElement("span");
      tooltip.textContent = (record.vehicleRegistration || record.gpsDeviceId || copy.unknownValue) + " · " +
        activityLabel(activity, copy) + " · " + (gpsVerified ? copy.gpsVerified : copy.notGpsVerified);
      marker.bindTooltip(tooltip, { direction: "top", offset: [0, -8], opacity: 0.96 });
      marker.on("click", () => onSelectRef.current(key));
      marker.addTo(markerLayer);
      markersByKeyRef.current.set(key, { marker, activity, approximate });
      bounds.push(position);
    }

    const shouldFitBounds = bounds.length > 0 && (
      !fittedBoundsRef.current ||
      bounds.some((position) => !map.getBounds().contains(Leaflet.latLng(position)))
    );
    if (shouldFitBounds) {
      const first = bounds[0];
      const allSamePosition = bounds.every((position) =>
        position[0] === first[0] && position[1] === first[1]
      );
      if (bounds.length === 1 || allSamePosition) map.setView(first, 13);
      else map.fitBounds(Leaflet.latLngBounds(bounds), { padding: [40, 40], maxZoom: 13 });
      fittedBoundsRef.current = true;
    }
  }, [copy, mapReady, positionedRecords]);

  useEffect(() => {
    const map = mapRef.current;
    const Leaflet = leafletRef.current;
    if (!mapReady || !map || !Leaflet) return;

    let selectedMarker: import("leaflet").Marker | null = null;
    for (const [key, entry] of markersByKeyRef.current) {
      const selected = key === selectedKey;
      entry.marker.setIcon(markerIcon(Leaflet, entry.activity, selected, entry.approximate));
      entry.marker.setZIndexOffset(selected ? 1000 : 0);
      if (selected) selectedMarker = entry.marker;
    }

    if (selectedKey && selectedMarker) {
      const position = selectedMarker.getLatLng();
      const previous = lastPannedSelectionRef.current;
      if (!previous || previous.key !== selectedKey || previous.latitude !== position.lat || previous.longitude !== position.lng) {
        map.panTo(position, { animate: true, duration: 0.25 });
        lastPannedSelectionRef.current = { key: selectedKey, latitude: position.lat, longitude: position.lng };
      }
    }
  }, [mapReady, positionedRecords, selectedKey]);

  return (
    <div className={styles.mapFrame} role="region" aria-label={copy.mapRegionLabel}>
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
