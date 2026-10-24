"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import styles from "./forth-tracking-map.module.css";
import {
  EES_FLEET_MAP_DEFAULT_CENTER,
  EES_FLEET_MAP_DEFAULT_ZOOM,
  getForthFleetMapRecords,
  getForthTrustedFleetMapInitialFrame,
  getForthReportedActivity,
  getForthTrackingVehicleIdentity,
  getForthMarkerCollisionGroups,
  getVisibleForthMarkerLabelKeys,
  isForthGpsPositionVerified,
  type ForthReportedActivity,
  type ForthTrackingMapVehicleClass
} from "@/lib/forth-tracking-view";
import type { ForthFleetTrackingRecord } from "@/lib/forth-tracking-server";

type Copy = {
  driving: string;
  uncertain: string;
  stopped: string;
  unavailable: string;
  gpsVerified: string;
  notGpsVerified: string;
  groupVehicles: string;
  expandGroup: string;
  groupPickerTitle: string;
  groupPickerDescription: string;
  groupSearch: string;
  groupSearchPlaceholder: string;
  closeGroupPicker: string;
  noGroupMatches: string;
  selectedVehicle: string;
  engineOn: string;
  engineOff: string;
  unknownValue: string;
  noPositions: string;
  loading: string;
  mapUnavailable: string;
  mapRegionLabel: string;
};

type ViewCommand = { type: "fit" | "focus"; sequence: number; key?: string | null };

type Props = {
  records: ForthFleetTrackingRecord[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  command: ViewCommand;
  filterKey: string;
  language: "en" | "th";
  copy: Copy;
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
  onMap: boolean;
};
type GroupMarkerEntry = { marker: FleetMarker; memberKeys: string[]; renderSignature: string };
type ActiveGroup = { signature: string; memberKeys: string[] };

const tileUrl = process.env.NEXT_PUBLIC_EES_MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

function activityLabel(activity: ForthReportedActivity, copy: Copy) {
  if (activity === "driving") return copy.driving;
  if (activity === "uncertain") return copy.uncertain;
  if (activity === "stopped_engine_on") return copy.stopped + " · " + copy.engineOn;
  if (activity === "stopped_engine_off") return copy.stopped + " · " + copy.engineOff;
  if (activity === "stopped_engine_unknown") return copy.stopped + " · " + copy.unknownValue;
  return copy.unavailable;
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("'", "&#39;");
}

function safeTooltipText(value: string) {
  const element = document.createElement("span");
  element.textContent = value;
  return element;
}

function markerIcon(
  Leaflet: LeafletModule,
  activity: ForthReportedActivity,
  selected: boolean,
  approximate: boolean,
  offline: boolean,
  registration: string,
  vehicleClass: ForthTrackingMapVehicleClass,
  make: string | null,
  labelOnLeft = false
) {
  const statusClass = activity === "driving"
    ? styles.vehicleMarkerDriving
    : activity === "uncertain"
      ? styles.vehicleMarkerUncertain
      : activity === "stopped_engine_on"
      ? styles.vehicleMarkerStoppedEngineOn
      : activity === "stopped_engine_off"
        ? styles.vehicleMarkerStoppedEngineOff
        : activity === "stopped_engine_unknown"
          ? styles.vehicleMarkerStoppedEngineUnknown
      : styles.vehicleMarkerUnavailable;
  const truckSvg = vehicleClass === "six_wheeler"
    ? "<path d=\"M2.5 7.5h11.5v9H2.5zM14 10h4l3 3v3h-7z\"/><circle cx=\"6\" cy=\"18\" r=\"1.7\"/><circle cx=\"14\" cy=\"18\" r=\"1.7\"/><circle cx=\"20\" cy=\"18\" r=\"1.7\"/>"
    : vehicleClass === "eighteen_wheeler"
      ? "<path d=\"M1 8h13v8H1zM14 10h5l4 3v3h-9z\"/><circle cx=\"3\" cy=\"18\" r=\"1.5\"/><circle cx=\"8\" cy=\"18\" r=\"1.5\"/><circle cx=\"13\" cy=\"18\" r=\"1.5\"/><circle cx=\"18\" cy=\"18\" r=\"1.5\"/><circle cx=\"22\" cy=\"18\" r=\"1.5\"/>"
      : vehicleClass === "four_wheeler"
        ? "<path d=\"M3 9h10l3 4h5v3H3z\"/><circle cx=\"7\" cy=\"18\" r=\"1.7\"/><circle cx=\"18\" cy=\"18\" r=\"1.7\"/>"
      : "<path d=\"M2.5 7.5h11.5v9H2.5zM14 10h4l3 3v3h-7z\"/><circle cx=\"6\" cy=\"18\" r=\"1.7\"/><circle cx=\"19\" cy=\"18\" r=\"1.7\"/>";
  const makeAccent = make === "Toyota" ? "#bfdbfe" : make === "Isuzu" ? "#a5f3fc" : make === "Nissan" ? "#fecdd3" : make === "Hino" ? "#fde68a" : "#e2e8f0";
  return Leaflet.divIcon({
    className: styles.vehicleMarker,
    html: "<span class=\"" + styles.vehicleMarkerDot + " " + statusClass +
      (approximate ? " " + styles.vehicleMarkerApproximate : "") +
      (offline ? " " + styles.vehicleMarkerOffline : "") +
      (selected ? " " + styles.vehicleMarkerSelected : "") + "\"><svg class=\"" + styles.vehicleMarkerTruck + "\" viewBox=\"0 0 24 24\" aria-hidden=\"true\">" + truckSvg + "<path d=\"M15.5 10h1.8\" style=\"stroke:" + makeAccent + "\"/></svg></span><span class=\"" + styles.vehicleMarkerLabel + (labelOnLeft ? " " + styles.vehicleMarkerLabelLeft : "") + "\">" + escapeHtml(registration) + "</span>",
    iconSize: [220, 36],
    iconAnchor: [17, 17],
    tooltipAnchor: [0, -18]
  });
}

function groupIcon(Leaflet: LeafletModule, count: number, selected: boolean) {
  return Leaflet.divIcon({
    className: styles.vehicleGroupIcon,
    html: `<span class="${styles.vehicleGroupBadge}${selected ? ` ${styles.vehicleGroupBadgeSelected}` : ""}" aria-hidden="true">${count}</span>`,
    iconSize: [44, 44],
    iconAnchor: [22, 22]
  });
}

function fitFleet(map: import("leaflet").Map, Leaflet: LeafletModule, positions: [number, number][]) {
  if (positions.length === 0) return;
  const first = positions[0];
  const allSamePosition = positions.every((position) => position[0] === first[0] && position[1] === first[1]);
  if (positions.length === 1 || allSamePosition) map.setView(first, 13, { animate: true });
  else map.fitBounds(Leaflet.latLngBounds(positions), { padding: [44, 44], maxZoom: 13, animate: true });
}

export const ForthTrackingMap = memo(function ForthTrackingMap({ records, selectedKey, onSelect, command, filterKey, language, copy }: Props) {
  const mapNodeRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const markersByKeyRef = useRef(new Map<string, FleetMarkerEntry>());
  const groupMarkersRef = useRef(new Map<string, GroupMarkerEntry>());
  const leafletRef = useRef<LeafletModule | null>(null);
  const copyRef = useRef(copy);
  const languageRef = useRef(language);
  const selectedKeyRef = useRef(selectedKey);
  const labelUpdateRef = useRef<() => void>(() => undefined);
  const spatialUpdateRef = useRef<() => void>(() => undefined);
  const onSelectRef = useRef(onSelect);
  const [activeGroup, setActiveGroup] = useState<ActiveGroup | null>(null);
  const activeGroupRef = useRef(activeGroup);
  const [groupSearch, setGroupSearch] = useState("");
  const initialFitCompleteRef = useRef(false);
  const lastCommandSequenceRef = useRef(0);
  const lastSelectedKeyRef = useRef<string | null>(null);
  const lastFilterKeyRef = useRef(filterKey);
  const [mapReady, setMapReady] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);

  const positionedRecords = useMemo(() => getForthFleetMapRecords(records), [records]);
  activeGroupRef.current = activeGroup;
  const activeGroupRecords = useMemo(() => {
    if (!activeGroup) return [];
    const memberKeys = new Set(activeGroup.memberKeys);
    return positionedRecords
      .filter(({ key }) => memberKeys.has(key))
      .sort((left, right) => (left.record.vehicleRegistration ?? "").localeCompare(right.record.vehicleRegistration ?? "", undefined, { numeric: true }));
  }, [activeGroup, positionedRecords]);
  const visibleGroupRecords = useMemo(() => {
    const query = groupSearch.trim().toLocaleLowerCase();
    if (!query) return activeGroupRecords;
    return activeGroupRecords.filter(({ record }) => (record.vehicleRegistration ?? "").toLocaleLowerCase().includes(query));
  }, [activeGroupRecords, groupSearch]);
  copyRef.current = copy;
  languageRef.current = language;
  selectedKeyRef.current = selectedKey;

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
        const Leaflet = (leafletModule as unknown as { default?: LeafletModule }).default ?? leafletModule;
        if (disposed || !mapNodeRef.current) return;

        map = Leaflet.map(mapNodeRef.current, {
          minZoom: 4,
          scrollWheelZoom: true,
          zoomControl: true,
          preferCanvas: true
        }).setView(EES_FLEET_MAP_DEFAULT_CENTER, EES_FLEET_MAP_DEFAULT_ZOOM);
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
        leafletRef.current = Leaflet;

        const updateMarkerLabels = () => {
          const currentMap = mapRef.current;
          if (!currentMap) return;
          const candidates = Array.from(markersByKeyRef.current.entries()).flatMap(([key, entry]) => {
            if (!entry.onMap) return [];
            const markerElement = entry.marker.getElement();
            const label = markerElement?.querySelector<HTMLElement>(`.${styles.vehicleMarkerLabel}`);
            if (!label) return [];
            const point = currentMap.latLngToContainerPoint(entry.marker.getLatLng());
            const labelWidth = label.offsetWidth || Math.min(150, 16 + entry.title.length * 7);
            const labelOnLeft = point.x + 20 + labelWidth > currentMap.getSize().x;
            label.classList.toggle(styles.vehicleMarkerLabelLeft, labelOnLeft);
            const labelLeft = labelOnLeft ? point.x - 20 - labelWidth : point.x + 20;
            return [{
              key,
              label,
              placement: {
                key,
                left: Math.min(point.x - 14, labelLeft),
                top: point.y - 13,
                width: Math.max(point.x + 14, labelLeft + labelWidth) - Math.min(point.x - 14, labelLeft),
                height: Math.max(26, label.offsetHeight),
                selected: entry.selected,
                priority: entry.activity === "driving" ? 2 : entry.activity.startsWith("stopped_") ? 1 : 0
              }
            }];
          });
          const visibleLabels = getVisibleForthMarkerLabelKeys(candidates.map(({ placement }) => placement), currentMap.getZoom());
          for (const candidate of candidates) {
            candidate.label.classList.toggle(styles.vehicleMarkerLabelHidden, !visibleLabels.has(candidate.key));
          }
        };
        labelUpdateRef.current = updateMarkerLabels;

        const updateSpatialPresentation = () => {
          const currentMap = mapRef.current;
          if (!currentMap || !leafletRef.current) return;
          const currentLeaflet = leafletRef.current;
          const entries = [...markersByKeyRef.current.entries()]
            .map(([key, entry]) => {
              const point = currentMap.latLngToContainerPoint(entry.marker.getLatLng());
              return { key, entry, point };
            });
          const groups = getForthMarkerCollisionGroups(entries.map(({ key, point }) => ({ key, x: point.x, y: point.y })), 72);
          const groupDetails = groups.map((keys) => {
            const memberKeys = [...keys].sort((left, right) => {
              const a = markersByKeyRef.current.get(left)?.title ?? left;
              const b = markersByKeyRef.current.get(right)?.title ?? right;
              return a.localeCompare(b, undefined, { numeric: true });
            });
            const signature = [...memberKeys].sort((left, right) => left.localeCompare(right)).join("\u0000");
            const markerPosition = markersByKeyRef.current.get(memberKeys[0])?.marker.getLatLng();
            return markerPosition ? { signature, memberKeys, markerPosition } : null;
          }).filter((group): group is NonNullable<typeof group> => group !== null);
          if (activeGroupRef.current && !groupDetails.some(({ signature }) => signature === activeGroupRef.current?.signature)) {
            activeGroupRef.current = null;
            setActiveGroup(null);
            setGroupSearch("");
          }

          const groupSignatures = new Set(groupDetails.map(({ signature }) => signature));
          const groupedKeys = new Set(groupDetails.flatMap(({ memberKeys }) => memberKeys));

          for (const [signature, group] of groupMarkersRef.current) {
            if (!groupSignatures.has(signature)) {
              group.marker.remove();
              groupMarkersRef.current.delete(signature);
            }
          }
          for (const group of groupDetails) {
            const selected = group.memberKeys.some((key) => markersByKeyRef.current.get(key)?.selected);
            const accessibleName = `${group.memberKeys.length} ${copyRef.current.groupVehicles}. ${copyRef.current.expandGroup}`;
            const renderSignature = [group.memberKeys.length, selected, copyRef.current.groupVehicles, copyRef.current.expandGroup].join("\u0001");
            let entry = groupMarkersRef.current.get(group.signature);
            if (!entry) {
              const marker = currentLeaflet.marker(group.markerPosition, {
                icon: groupIcon(currentLeaflet, group.memberKeys.length, selected),
                title: accessibleName,
                alt: accessibleName,
                keyboard: true,
                riseOnHover: true
              }).addTo(currentMap);
              marker.on("click", () => {
                const currentMembers = groupMarkersRef.current.get(group.signature)?.memberKeys ?? group.memberKeys;
                setActiveGroup({ signature: group.signature, memberKeys: [...currentMembers] });
                setGroupSearch("");
              });
              marker.on("focus", () => marker.openTooltip());
              marker.on("blur", () => marker.closeTooltip());
              const tooltip = safeTooltipText(accessibleName);
              marker.bindTooltip(tooltip, { direction: "top", opacity: 0.98 });
              marker.getElement()?.setAttribute("aria-label", accessibleName);
              entry = { marker, memberKeys: group.memberKeys, renderSignature };
              groupMarkersRef.current.set(group.signature, entry);
            } else {
              if (entry.renderSignature !== renderSignature) {
                entry.marker.setIcon(groupIcon(currentLeaflet, group.memberKeys.length, selected));
                entry.renderSignature = renderSignature;
              }
              entry.memberKeys = group.memberKeys;
              const previousGroupPosition = entry.marker.getLatLng();
              if (previousGroupPosition.lat !== group.markerPosition.lat || previousGroupPosition.lng !== group.markerPosition.lng) {
                entry.marker.setLatLng(group.markerPosition);
              }
              entry.marker.setTooltipContent(safeTooltipText(accessibleName));
              entry.marker.options.title = accessibleName;
              entry.marker.options.alt = accessibleName;
              entry.marker.getElement()?.setAttribute("aria-label", accessibleName);
              entry.marker.getElement()?.setAttribute("title", accessibleName);
            }
          }

          for (const [key, entry] of markersByKeyRef.current) {
            const shouldShowOriginal = !groupedKeys.has(key);
            if (shouldShowOriginal && !entry.onMap) {
              entry.marker.addTo(currentMap);
              entry.onMap = true;
            } else if (!shouldShowOriginal && entry.onMap) {
              entry.marker.remove();
              entry.onMap = false;
            }
          }

          window.requestAnimationFrame(() => labelUpdateRef.current());
        };
        spatialUpdateRef.current = updateSpatialPresentation;

        map.on("zoomstart", () => {
          activeGroupRef.current = null;
          setActiveGroup(null);
          setGroupSearch("");
          updateSpatialPresentation();
        });
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

    void initializeMap();
    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      map?.remove();
      mapRef.current = null;
      labelUpdateRef.current = () => undefined;
      spatialUpdateRef.current = () => undefined;
      markersByKeyRef.current.clear();
      groupMarkersRef.current.clear();
      leafletRef.current = null;
    };
  }, []);

  // Keep original Leaflet markers and their Forth coordinates stable across polling.
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
      const tooltipSignature = [markerTitle, activityLabel(activity, copy), confidenceLabel].join("\u0000");
      let entry = markersByKeyRef.current.get(key);
      if (!entry) {
        const selected = key === selectedKeyRef.current;
        const marker = Leaflet.marker(position, {
          icon: markerIcon(Leaflet, activity, selected, approximate, offline, markerTitle, identity.vehicleClass, identity.make),
          title: markerTitle,
          alt: `${markerTitle} · ${confidenceLabel}`,
          zIndexOffset: selected ? 1200 : 0,
          keyboard: true,
          riseOnHover: true
        }).addTo(map);
        marker.on("click", () => onSelectRef.current(key));
        marker.on("focus", () => marker.openTooltip());
        marker.on("blur", () => marker.closeTooltip());
        entry = { marker, activity, approximate, offline, selected, title: markerTitle, vehicleClass: identity.vehicleClass, make: identity.make, tooltipSignature: "", onMap: true };
        markersByKeyRef.current.set(key, entry);
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
          entry.marker.setIcon(markerIcon(Leaflet, activity, entry.selected, approximate, offline, markerTitle, identity.vehicleClass, identity.make));
          entry.marker.options.title = markerTitle;
          entry.marker.options.alt = `${markerTitle} · ${confidenceLabel}`;
          entry.marker.getElement()?.setAttribute("aria-label", `${markerTitle} · ${confidenceLabel}`);
          entry.marker.getElement()?.setAttribute("title", markerTitle);
        }
      }

      if (entry.tooltipSignature !== tooltipSignature) {
        const tooltip = safeTooltipText(`${markerTitle} · ${activityLabel(activity, copy)} · ${confidenceLabel}`);
        if (entry.marker.getTooltip()) entry.marker.setTooltipContent(tooltip);
        else entry.marker.bindTooltip(tooltip, { direction: "top", offset: [0, -8], opacity: 0.96 });
        entry.tooltipSignature = tooltipSignature;
      }
    }

    spatialUpdateRef.current();
  }, [copy, language, mapReady, positionedRecords]);

  // Fit once on first data. Routine polling does not pan or zoom the map.
  useEffect(() => {
    const map = mapRef.current;
    const Leaflet = leafletRef.current;
    if (!mapReady || !map || !Leaflet || initialFitCompleteRef.current || positionedRecords.length === 0) return;
    const initialFrame = getForthTrustedFleetMapInitialFrame(records);
    if (initialFrame.focusPositions.length > 0) fitFleet(map, Leaflet, initialFrame.focusPositions);
    initialFitCompleteRef.current = true;
  }, [mapReady, positionedRecords]);

  useEffect(() => {
    const map = mapRef.current;
    const Leaflet = leafletRef.current;
    if (!mapReady || !map || !Leaflet || command.sequence === 0 || command.sequence === lastCommandSequenceRef.current) return;
    lastCommandSequenceRef.current = command.sequence;

    if (command.type === "fit") {
      activeGroupRef.current = null;
      setActiveGroup(null);
      setGroupSearch("");
      fitFleet(map, Leaflet, getForthTrustedFleetMapInitialFrame(records).focusPositions);
      return;
    }
    if (command.type === "focus" && command.key) {
      const marker = markersByKeyRef.current.get(command.key)?.marker;
      if (!marker) return;
      const position = marker.getLatLng();
      activeGroupRef.current = null;
      setActiveGroup(null);
      setGroupSearch("");
      map.flyTo(position, Math.min(16, Math.max(13, map.getZoom())), { duration: 0.35 });
    }
  }, [command, mapReady, positionedRecords]);

  useEffect(() => {
    if (lastFilterKeyRef.current === filterKey) return;
    lastFilterKeyRef.current = filterKey;
    activeGroupRef.current = null;
    setActiveGroup(null);
    setGroupSearch("");
    spatialUpdateRef.current();
  }, [filterKey, mapReady]);

  useEffect(() => {
    const Leaflet = leafletRef.current;
    if (!mapReady || !Leaflet) return;
    const previousSelectedKey = lastSelectedKeyRef.current;
    for (const key of new Set([previousSelectedKey, selectedKey])) {
      const entry = key ? markersByKeyRef.current.get(key) : undefined;
      if (!entry) continue;
      const selected = key === selectedKey;
      if (entry.selected !== selected) {
        entry.selected = selected;
        entry.marker.setIcon(markerIcon(Leaflet, entry.activity, selected, entry.approximate, entry.offline, entry.title, entry.vehicleClass, entry.make));
        entry.marker.setZIndexOffset(selected ? 1200 : 0);
      }
    }
    if (previousSelectedKey !== selectedKey) {
      activeGroupRef.current = null;
      setActiveGroup(null);
      setGroupSearch("");
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
      {mapReady && positionedRecords.length === 0 ? <div className={styles.mapNotice} role="status">{copy.noPositions}</div> : null}
      {activeGroup ? (
        <aside className={styles.collisionPicker} aria-label={copy.groupPickerTitle}>
          <header className={styles.collisionPickerHeader}>
            <div className={styles.collisionPickerHeading}>
              <strong>{copy.groupPickerTitle}</strong>
              <span>{copy.groupPickerDescription}</span>
            </div>
            <button type="button" className={styles.collisionPickerClose} onClick={() => { setActiveGroup(null); setGroupSearch(""); }} aria-label={copy.closeGroupPicker}>×</button>
          </header>
          <label className={styles.collisionPickerSearch}>
            <span className="sr-only">{copy.groupSearch}</span>
            <input type="search" value={groupSearch} onChange={(event) => setGroupSearch(event.target.value)} placeholder={copy.groupSearchPlaceholder} />
          </label>
          {visibleGroupRecords.length > 0 ? (
            <ul className={styles.collisionVehicleList} aria-label={copy.groupPickerTitle}>
              {visibleGroupRecords.map(({ record, key }) => (
                <li key={key}>
                  <button type="button" aria-pressed={selectedKey === key} className={`${styles.collisionVehicleRow} ${selectedKey === key ? styles.collisionVehicleSelected : ""}`} onClick={() => {
                    setActiveGroup(null);
                    setGroupSearch("");
                    onSelect(key);
                  }}>
                    <span>{record.vehicleRegistration || copy.unknownValue}</span>
                    {selectedKey === key ? <span className={styles.collisionVehicleCurrent}>{copy.selectedVehicle}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className={styles.collisionPickerEmpty} role="status">{copy.noGroupMatches}</p>}
        </aside>
      ) : null}
    </div>
  );
});
