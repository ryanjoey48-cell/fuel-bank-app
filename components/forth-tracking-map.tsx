"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import styles from "./forth-tracking-map.module.css";
import {
  getForthFleetRecordKey,
  getForthFleetStatus,
  type ForthFleetStatus
} from "@/lib/forth-tracking-view";
import type { ForthFleetTrackingRecord } from "@/lib/forth-tracking-server";

type Copy = {
  moving: string;
  parked: string;
  offline: string;
  unknown: string;
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

function statusLabel(status: ForthFleetStatus, copy: Copy) {
  if (status === "moving") return copy.moving;
  if (status === "parked") return copy.parked;
  if (status === "offline_stale") return copy.offline;
  return copy.unknown;
}

function markerColors(status: ForthFleetStatus, selected: boolean) {
  const fill = status === "moving"
    ? "#059669"
    : status === "parked"
      ? "#4f46e5"
      : status === "offline_stale"
        ? "#d97706"
        : "#64748b";
  return {
    color: selected ? "#111827" : "#ffffff",
    fillColor: fill,
    fillOpacity: 0.98,
    opacity: 1,
    radius: selected ? 10 : 7,
    weight: selected ? 4 : 2
  };
}

export function ForthTrackingMap({ records, selectedKey, onSelect, language, copy }: Props) {
  const mapNodeRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const markerLayerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const markersByKeyRef = useRef(new Map<string, { marker: import("leaflet").CircleMarker; status: ForthFleetStatus }>());
  const leafletRef = useRef<LeafletModule | null>(null);
  const onSelectRef = useRef(onSelect);
  const fittedInitialBoundsRef = useRef(false);
  const lastPannedSelectionRef = useRef<{ key: string; latitude: number; longitude: number } | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);

  const positionedRecords = useMemo(() => records.flatMap((record, index) => {
    if (record.coordinateStatus !== "valid" || record.latitude === null || record.longitude === null) return [];
    return [{ record, key: getForthFleetRecordKey(record, index) }];
  }), [records]);

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
    const bounds: import("leaflet").LatLngExpression[] = [];

    for (const { record, key } of positionedRecords) {
      const position: import("leaflet").LatLngExpression = [record.latitude!, record.longitude!];
      const status = getForthFleetStatus(record);
      const marker = Leaflet.circleMarker(position, markerColors(status, false));
      const content = document.createElement("div");
      content.className = "forth-tracking-popup";
      const title = document.createElement("strong");
      title.textContent = record.vehicleRegistration || record.gpsDeviceId || copy.unknown;
      const state = document.createElement("span");
      state.textContent = statusLabel(status, copy);
      content.append(title, state);
      marker.bindPopup(content, { closeButton: true, autoPanPadding: [24, 24] });
      const tooltip = document.createElement("span");
      tooltip.textContent = `${record.vehicleRegistration || record.gpsDeviceId || copy.unknown} · ${statusLabel(status, copy)}`;
      marker.bindTooltip(tooltip, { direction: "top", offset: [0, -8], opacity: 0.96 });
      marker.on("click", () => onSelectRef.current(key));
      marker.addTo(markerLayer);
      markersByKeyRef.current.set(key, { marker, status });
      bounds.push(position);
    }

    if (!fittedInitialBoundsRef.current && bounds.length > 0) {
      if (bounds.length === 1) map.setView(bounds[0], 13);
      else map.fitBounds(Leaflet.latLngBounds(bounds), { padding: [32, 32], maxZoom: 13 });
      fittedInitialBoundsRef.current = true;
    }
  }, [copy, mapReady, positionedRecords]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;

    let selectedMarker: import("leaflet").CircleMarker | null = null;
    for (const [key, entry] of markersByKeyRef.current) {
      const selected = key === selectedKey;
      entry.marker.setStyle(markerColors(entry.status, selected));
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
