"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import styles from "./fleet-map.module.css";
import {
  FLEET_TRACKING_V2_MAP_ENGINE,
  FLEET_TRACKING_V2_TILE_ATTRIBUTION,
  FLEET_TRACKING_V2_TILE_URL
} from "@/lib/fleet-tracking-v2/map-engine";
import type { SyntheticVehicle } from "@/lib/fleet-tracking-v2/synthetic-fleet";
import {
  FLEET_V2_COLLISION_RADIUS_PX,
  FLEET_V2_DEFAULT_ZOOM,
  FLEET_V2_FOCUS_ZOOM,
  FLEET_V2_LABEL_ZOOM,
  FLEET_V2_MARKER_SIZE_PX,
  FLEET_V2_OPERATING_CENTER,
  canFocusVehicle,
  getMapVehicles,
  getMarkerCollisionGroups,
  getMotionState,
  getOperatingAreaPositions,
  getVisibleMarkerLabelKeys,
  shouldOpenClusterPicker
} from "@/lib/fleet-tracking-v2/view";

type LeafletModule = typeof import("leaflet");
type FleetMarker = import("leaflet").Marker;
type ViewCommand = { type: "fit" | "focus"; sequence: number; key?: string | null };

type Props = {
  vehicles: SyntheticVehicle[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCluster: (ids: string[]) => void;
  command: ViewCommand;
  mapUnavailable: string;
};

void FLEET_TRACKING_V2_MAP_ENGINE;

const truckSvg =
  '<path d="M3 9h10l3 4h5v3H3z"/><circle cx="7" cy="18" r="1.6"/><circle cx="18" cy="18" r="1.6"/>';
const markerAnchor = Math.round(FLEET_V2_MARKER_SIZE_PX / 2);

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function markerIcon(
  Leaflet: LeafletModule,
  motion: "moving" | "stopped",
  selected: boolean,
  registration: string
) {
  return Leaflet.divIcon({
    className: styles.marker,
    html:
      `<span class="${styles.dot} ${styles[motion]}${selected ? ` ${styles.selected}` : ""}"><svg viewBox="0 0 24 24" aria-hidden="true">${truckSvg}</svg></span>` +
      `<span class="${styles.label}${selected ? ` ${styles.labelSelected}` : ""}">${escapeHtml(registration)}</span>`,
    iconSize: [FLEET_V2_MARKER_SIZE_PX, FLEET_V2_MARKER_SIZE_PX],
    iconAnchor: [markerAnchor, markerAnchor]
  });
}

function groupIcon(Leaflet: LeafletModule, count: number, selected: boolean) {
  return Leaflet.divIcon({
    className: styles.group,
    html: `<span class="${styles.badge}${selected ? ` ${styles.badgeSelected}` : ""}">${count}</span>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15]
  });
}

function fitArea(map: import("leaflet").Map, Leaflet: LeafletModule, positions: [number, number][]) {
  if (positions.length === 0) {
    map.setView(FLEET_V2_OPERATING_CENTER, FLEET_V2_DEFAULT_ZOOM, { animate: true });
    return;
  }
  const first = positions[0];
  const same = positions.every((position) => position[0] === first[0] && position[1] === first[1]);
  if (same) map.setView(first, 13, { animate: true });
  else map.fitBounds(Leaflet.latLngBounds(positions), { padding: [48, 48], maxZoom: 11, animate: true });
}

export const FleetTrackingV2Map = memo(function FleetTrackingV2Map({
  vehicles,
  selectedId,
  onSelect,
  onCluster,
  command,
  mapUnavailable
}: Props) {
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const leafletRef = useRef<LeafletModule | null>(null);
  const markersRef = useRef(new Map<string, { marker: FleetMarker; motion: string; selected: boolean }>());
  const groupsRef = useRef(new Map<string, { marker: FleetMarker; memberIds: string[] }>());
  const onSelectRef = useRef(onSelect);
  const onClusterRef = useRef(onCluster);
  const selectedRef = useRef(selectedId);
  const labelUpdateRef = useRef<() => void>(() => undefined);
  const spatialUpdateRef = useRef<() => void>(() => undefined);
  const fittedRef = useRef(false);
  const lastCommandRef = useRef(0);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  const mapVehicles = useMemo(() => getMapVehicles(vehicles), [vehicles]);
  onSelectRef.current = onSelect;
  onClusterRef.current = onCluster;
  selectedRef.current = selectedId;

  useEffect(() => {
    let disposed = false;
    let map: import("leaflet").Map | null = null;
    let resizeObserver: ResizeObserver | null = null;

    async function start() {
      try {
        const leafletModule = await import("leaflet");
        const Leaflet = (leafletModule as unknown as { default?: LeafletModule }).default ?? leafletModule;
        if (disposed || !nodeRef.current) return;
        map = Leaflet.map(nodeRef.current, {
          zoomControl: true,
          attributionControl: true,
          maxZoom: 18
        }).setView(FLEET_V2_OPERATING_CENTER, FLEET_V2_DEFAULT_ZOOM);
        Leaflet.tileLayer(FLEET_TRACKING_V2_TILE_URL, {
          attribution: FLEET_TRACKING_V2_TILE_ATTRIBUTION,
          maxZoom: 18
        }).addTo(map);
        mapRef.current = map;
        leafletRef.current = Leaflet;

        const updateLabels = () => {
          const currentMap = mapRef.current;
          if (!currentMap) return;
          const candidates = [...markersRef.current.entries()].flatMap(([key, entry]) => {
            if (!currentMap.hasLayer(entry.marker)) return [];
            const element = entry.marker.getElement();
            const label = element?.querySelector(`.${styles.label}`) as HTMLElement | null;
            if (!element || !label) return [];
            const rect = element.getBoundingClientRect();
            const labelRect = label.getBoundingClientRect();
            return [{
              key,
              label,
              placement: {
                key,
                left: labelRect.left,
                top: labelRect.top,
                width: labelRect.width || 80,
                height: labelRect.height || 16,
                selected: selectedRef.current === key
              },
              markerRect: rect
            }];
          });
          const visible = getVisibleMarkerLabelKeys(
            candidates.map((candidate) => candidate.placement),
            currentMap.getZoom(),
            FLEET_V2_LABEL_ZOOM
          );
          for (const candidate of candidates) {
            candidate.label.classList.toggle(styles.labelHidden, !visible.has(candidate.key));
          }
        };
        labelUpdateRef.current = updateLabels;

        const expandCluster = (memberIds: string[]) => {
          const currentMap = mapRef.current;
          const currentLeaflet = leafletRef.current;
          if (!currentMap || !currentLeaflet) return;
          const positions = memberIds.flatMap((id) => {
            const latLng = markersRef.current.get(id)?.marker.getLatLng();
            return latLng ? [[latLng.lat, latLng.lng] as [number, number]] : [];
          });
          if (shouldOpenClusterPicker(positions, currentMap.getZoom(), currentMap.getMaxZoom())) {
            onClusterRef.current([...memberIds]);
            return;
          }
          currentMap.fitBounds(currentLeaflet.latLngBounds(positions), {
            padding: [56, 56],
            maxZoom: Math.min(18, currentMap.getMaxZoom()),
            animate: true
          });
        };

        const updateSpatial = () => {
          const currentMap = mapRef.current;
          const currentLeaflet = leafletRef.current;
          if (!currentMap || !currentLeaflet) return;
          for (const group of groupsRef.current.values()) currentMap.removeLayer(group.marker);
          groupsRef.current.clear();
          const entries = [...markersRef.current.entries()].map(([key, entry]) => ({
            key,
            entry,
            point: currentMap.latLngToContainerPoint(entry.marker.getLatLng())
          }));
          const groups = getMarkerCollisionGroups(
            entries.map(({ key, point }) => ({ key, x: point.x, y: point.y })),
            FLEET_V2_COLLISION_RADIUS_PX
          );
          const clustered = new Set(groups.flat());
          for (const { key, entry } of entries) {
            if (clustered.has(key)) {
              if (currentMap.hasLayer(entry.marker)) currentMap.removeLayer(entry.marker);
            } else if (!currentMap.hasLayer(entry.marker)) {
              entry.marker.addTo(currentMap);
            }
          }
          for (const memberIds of groups) {
            const first = markersRef.current.get(memberIds[0]);
            if (!first) continue;
            const selected = memberIds.includes(selectedRef.current ?? "");
            const marker = currentLeaflet.marker(first.marker.getLatLng(), {
              icon: groupIcon(currentLeaflet, memberIds.length, selected),
              zIndexOffset: selected ? 900 : 400,
              keyboard: true,
              title: String(memberIds.length)
            }).addTo(currentMap);
            marker.on("click", () => expandCluster(memberIds));
            groupsRef.current.set(memberIds.slice().sort().join("|"), { marker, memberIds });
          }
          updateLabels();
        };
        spatialUpdateRef.current = updateSpatial;
        map.on("zoomend moveend", updateSpatial);
        resizeObserver = new ResizeObserver(() => map?.invalidateSize());
        resizeObserver.observe(nodeRef.current);
        setReady(true);
      } catch {
        if (!disposed) setFailed(true);
      }
    }

    start();
    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      map?.remove();
      mapRef.current = null;
      leafletRef.current = null;
      markersRef.current.clear();
      groupsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const Leaflet = leafletRef.current;
    if (!ready || !map || !Leaflet) return;
    const nextIds = new Set(mapVehicles.map((vehicle) => vehicle.id));
    for (const [id, entry] of markersRef.current) {
      if (!nextIds.has(id)) {
        map.removeLayer(entry.marker);
        markersRef.current.delete(id);
      }
    }
    for (const vehicle of mapVehicles) {
      if (!canFocusVehicle(vehicle) || vehicle.latitude === null || vehicle.longitude === null) continue;
      const motion = getMotionState(vehicle) === "moving" ? "moving" : "stopped";
      const selected = selectedId === vehicle.id;
      const existing = markersRef.current.get(vehicle.id);
      if (existing) {
        existing.marker.setLatLng([vehicle.latitude, vehicle.longitude]);
        if (existing.motion !== motion || existing.selected !== selected) {
          existing.marker.setIcon(markerIcon(Leaflet, motion, selected, vehicle.registration));
          existing.motion = motion;
          existing.selected = selected;
        }
        existing.marker.setZIndexOffset(selected ? 1200 : 0);
      } else {
        const marker = Leaflet.marker([vehicle.latitude, vehicle.longitude], {
          icon: markerIcon(Leaflet, motion, selected, vehicle.registration),
          keyboard: true,
          title: vehicle.registration,
          zIndexOffset: selected ? 1200 : 0
        });
        marker.on("click", () => onSelectRef.current(vehicle.id));
        markersRef.current.set(vehicle.id, { marker, motion, selected });
      }
    }
    spatialUpdateRef.current();
  }, [mapVehicles, ready, selectedId]);

  useEffect(() => {
    const map = mapRef.current;
    const Leaflet = leafletRef.current;
    if (!ready || !map || !Leaflet || fittedRef.current) return;
    fittedRef.current = true;
    fitArea(map, Leaflet, getOperatingAreaPositions(vehicles));
  }, [ready, vehicles]);

  useEffect(() => {
    const map = mapRef.current;
    const Leaflet = leafletRef.current;
    if (!ready || !map || !Leaflet || command.sequence === lastCommandRef.current) return;
    lastCommandRef.current = command.sequence;
    if (command.type === "fit") {
      fitArea(map, Leaflet, getOperatingAreaPositions(vehicles));
      return;
    }
    if (command.type === "focus" && command.key) {
      const marker = markersRef.current.get(command.key)?.marker;
      if (!marker) return;
      map.flyTo(marker.getLatLng(), FLEET_V2_FOCUS_ZOOM, { duration: 0.28 });
    }
  }, [command, ready, vehicles]);

  if (failed) return <div className={styles.failed}>{mapUnavailable}</div>;
  return <div className={styles.frame}><div ref={nodeRef} className={styles.canvas} /></div>;
});
