"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import { ArrowUpRight, Crosshair, LoaderCircle, MapPin, MousePointer2 } from "lucide-react";
import type { Map as LeafletMap, MarkerClusterGroup } from "leaflet";
import styles from "./locations-map.module.css";
import {
  formatCoordinates,
  getDispatchRestriction,
  getLocationDisplayName,
  getLocationMapUrl,
  getUnpinnedLocationIds,
  isValidCoordinates,
  parseCoordinates,
  safeGoogleMapsUrl,
  type Coordinates,
  type LocationPin,
  type LocationPinType
} from "@/lib/locations-directory";
import type { Translation } from "@/lib/translations";

type MapLocation = {
  id: string;
  company_name: string;
  thai_name: string | null;
  address: string;
  google_maps_url: string | null;
  truck_entrance_url?: string | null;
  dispatch_restriction?: string | null;
  notes?: string | null;
  source_info?: string | null;
};

export type SaveLocationPinInput = Coordinates & {
  location_id: string;
  pin_type: LocationPinType;
  coordinate_source: string;
  source_reference: string | null;
};

type Props = {
  locations: MapLocation[];
  visibleLocations: MapLocation[];
  pins: LocationPin[];
  storageReady: boolean;
  storageLoading: boolean;
  canEdit: boolean;
  language: "en" | "th";
  copy: Translation["locations"];
  selectedLocationId: string;
  onSelectedLocationChange: (locationId: string) => void;
  pinType: LocationPinType;
  onPinTypeChange: (pinType: LocationPinType) => void;
  onMarkUsed: (location: MapLocation) => void;
  onSavePin: (pin: SaveLocationPinInput) => Promise<LocationPin>;
};

const tileUrl = process.env.NEXT_PUBLIC_EES_MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

function buildPopup(location: MapLocation, pinType: LocationPinType, language: "en" | "th", openLabel: string, truckEntranceLabel: string, onOpen: () => void) {
  const container = document.createElement("div");
  container.className = "ees-map-popup";
  const title = document.createElement("strong");
  title.textContent = getLocationDisplayName(location, language);
  const address = document.createElement("p");
  address.textContent = location.address;
  const restrictionText = location.dispatch_restriction ?? getDispatchRestriction(location);
  if (restrictionText) {
    const restriction = document.createElement("p");
    restriction.className = "ees-map-popup__restriction";
    restriction.textContent = restrictionText;
    container.append(title, address, restriction);
  } else {
    container.append(title, address);
  }

  const mapUrl = pinType === "truck_entrance"
    ? safeGoogleMapsUrl(location.truck_entrance_url) ?? getLocationMapUrl(location)
    : getLocationMapUrl(location);
  if (mapUrl) {
    const link = document.createElement("a");
    link.href = mapUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = openLabel;
    link.className = "ees-map-popup__link";
    link.addEventListener("click", onOpen);
    container.append(link);
  }
  const type = document.createElement("span");
  type.className = "ees-map-popup__type";
  type.textContent = pinType === "truck_entrance" ? ` · ${truckEntranceLabel}` : "";
  title.append(type);
  return container;
}

export function LocationsMap({
  locations,
  visibleLocations,
  pins,
  storageReady,
  storageLoading,
  canEdit,
  language,
  copy,
  selectedLocationId,
  onSelectedLocationChange,
  pinType,
  onPinTypeChange,
  onMarkUsed,
  onSavePin
}: Props) {
  const mapNodeRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const clusterRef = useRef<MarkerClusterGroup | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const candidateMarkerRef = useRef<import("leaflet").Marker | null>(null);
  const pickingRef = useRef(false);
  const mapClickRef = useRef<(coordinate: Coordinates) => void>(() => undefined);
  const onMarkUsedRef = useRef(onMarkUsed);
  const [mapReady, setMapReady] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const [coordinates, setCoordinates] = useState("");
  const [candidate, setCandidate] = useState<Coordinates | null>(null);
  const [coordinateSource, setCoordinateSource] = useState("");
  const [sourceReference, setSourceReference] = useState("");
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [saveSucceeded, setSaveSucceeded] = useState(false);
  const [selectedMapPin, setSelectedMapPin] = useState<{ locationId: string; pinType: LocationPinType } | null>(null);

  const locationById = useMemo(() => new Map(locations.map((location) => [location.id, location])), [locations]);
  const visibleIds = useMemo(() => new Set(visibleLocations.map((location) => location.id)), [visibleLocations]);
  const selectedEditorLocation = selectedLocationId ? locationById.get(selectedLocationId) ?? null : null;
  const selectedPin = pins.find((pin) => pin.location_id === selectedLocationId && pin.pin_type === pinType);
  const unpinnedIds = useMemo(() => getUnpinnedLocationIds(locations, pins), [locations, pins]);
  const selectedMarker = selectedMapPin ? locationById.get(selectedMapPin.locationId) ?? null : null;
  const selectedMarkerUrl = selectedMarker
    ? selectedMapPin?.pinType === "truck_entrance"
      ? safeGoogleMapsUrl(selectedMarker.truck_entrance_url) ?? getLocationMapUrl(selectedMarker)
      : getLocationMapUrl(selectedMarker)
    : null;
  const coordinateError = coordinates.length > 0 && !parseCoordinates(coordinates);

  useEffect(() => {
    pickingRef.current = picking;
  }, [picking]);

  useEffect(() => {
    onMarkUsedRef.current = onMarkUsed;
  }, [onMarkUsed]);

  useEffect(() => {
    const mapClick = (point: Coordinates) => {
      setCandidate(point);
      setCoordinates(formatCoordinates(point));
      setPicking(false);
      setSaveError(false);
      setSaveSucceeded(false);
      mapRef.current?.panTo([point.latitude, point.longitude]);
    };
    mapClickRef.current = mapClick;
  }, []);

  useEffect(() => {
    let disposed = false;
    let activeMap: LeafletMap | null = null;

    async function initializeMap() {
      if (!mapNodeRef.current) return;
      try {
        const leafletModule = await import("leaflet");
        await import("leaflet.markercluster");
        const Leaflet = (leafletModule as unknown as { default?: typeof import("leaflet") }).default ?? leafletModule;
        if (disposed || !mapNodeRef.current) return;

        const map = Leaflet.map(mapNodeRef.current, {
          center: [15, 101],
          zoom: 6,
          minZoom: 4,
          zoomControl: true,
          scrollWheelZoom: true
        });
        activeMap = map;
        mapRef.current = map;
        leafletRef.current = Leaflet;
        Leaflet.tileLayer(tileUrl, {
          maxZoom: 19,
          minZoom: 4,
          keepBuffer: 2,
          updateWhenIdle: true,
          updateWhenZooming: false,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>'
        }).addTo(map);

        const cluster = Leaflet.markerClusterGroup({
          maxClusterRadius: 46,
          showCoverageOnHover: false,
          spiderfyOnMaxZoom: true,
          animate: true
        });
        cluster.addTo(map);
        clusterRef.current = cluster;
        map.on("click", (event) => {
          if (pickingRef.current) mapClickRef.current({ latitude: event.latlng.lat, longitude: event.latlng.lng });
          else setSelectedMapPin(null);
        });
        setMapReady(true);
        window.setTimeout(() => map.invalidateSize(), 0);
      } catch {
        if (!disposed) setMapFailed(true);
      }
    }

    void initializeMap();
    return () => {
      disposed = true;
      activeMap?.remove();
      if (mapRef.current === activeMap) mapRef.current = null;
      clusterRef.current = null;
      leafletRef.current = null;
      candidateMarkerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapReady || !mapRef.current || !clusterRef.current || !leafletRef.current) return;
    const Leaflet = leafletRef.current;
    const cluster = clusterRef.current;
    cluster.clearLayers();

    pins.forEach((pin) => {
      if (!visibleIds.has(pin.location_id) || !isValidCoordinates(pin.latitude, pin.longitude)) return;
      const location = locationById.get(pin.location_id);
      if (!location) return;
      const truckClass = pin.pin_type === "truck_entrance" ? " ees-map-pin--truck" : "";
      const marker = Leaflet.marker([pin.latitude, pin.longitude], {
        title: `${getLocationDisplayName(location, language)}${pin.pin_type === "truck_entrance" ? ` — ${copy.truckEntrance}` : ""}`,
        icon: Leaflet.divIcon({
          className: "",
          html: `<span class="ees-map-pin${truckClass}"><span></span></span>`,
          iconSize: [34, 42],
          iconAnchor: [17, 42]
        }),
        keyboard: true
      });
      marker.bindPopup(buildPopup(location, pin.pin_type, language, copy.map, copy.truckEntrance, () => onMarkUsedRef.current(location)), { maxWidth: 300, minWidth: 190, className: "ees-location-popup" });
      marker.on("click", () => setSelectedMapPin({ locationId: location.id, pinType: pin.pin_type }));
      cluster.addLayer(marker);
    });

    const point = candidate;
    if (point && isValidCoordinates(point.latitude, point.longitude)) {
      if (candidateMarkerRef.current) candidateMarkerRef.current.remove();
      candidateMarkerRef.current = Leaflet.marker([point.latitude, point.longitude], {
        interactive: false,
        zIndexOffset: 1000,
        icon: Leaflet.divIcon({ className: "", html: '<span class="ees-map-candidate"></span>', iconSize: [28, 28], iconAnchor: [14, 14] })
      }).addTo(mapRef.current);
    } else if (candidateMarkerRef.current) {
      candidateMarkerRef.current.remove();
      candidateMarkerRef.current = null;
    }
  }, [candidate, copy.map, copy.truckEntrance, language, locationById, mapReady, pins, visibleIds]);

  useEffect(() => {
    const pin = selectedPin;
    setCoordinates(pin ? formatCoordinates(pin) : "");
    setCoordinateSource(pin?.coordinate_source ?? "");
    setSourceReference(pin?.source_reference ?? "");
  }, [selectedPin]);

  useEffect(() => {
    setCandidate(null);
    setPicking(false);
    setSaveError(false);
    setSaveSucceeded(false);
  }, [selectedLocationId, pinType]);

  useEffect(() => {
    if (!mapRef.current || !selectedPin) return;
    mapRef.current.setView([selectedPin.latitude, selectedPin.longitude], Math.max(mapRef.current.getZoom(), 13));
  }, [selectedPin]);

  const previewCoordinates = useCallback(() => {
    const parsed = parseCoordinates(coordinates);
    if (!parsed) return;
    setCandidate(parsed);
    setCoordinates(formatCoordinates(parsed));
    setSaveError(false);
    setSaveSucceeded(false);
    mapRef.current?.setView([parsed.latitude, parsed.longitude], Math.max(mapRef.current.getZoom(), 13));
  }, [coordinates]);

  async function confirmAndSave() {
    if (!candidate || !selectedLocationId || !coordinateSource.trim() || !canEdit || !storageReady) return;
    setSaving(true);
    setSaveError(false);
    setSaveSucceeded(false);
    try {
      await onSavePin({
        location_id: selectedLocationId,
        pin_type: pinType,
        latitude: candidate.latitude,
        longitude: candidate.longitude,
        coordinate_source: coordinateSource.trim(),
        source_reference: sourceReference.trim() || null
      });
      setCandidate(null);
      setSaveSucceeded(true);
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  const candidateCount = candidate ? 1 : 0;
  const confirmedCount = pins.filter((pin) => pin.pin_status === "manual_confirmed").length;

  return <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-label={copy.mapView}>
    <div className="grid gap-2 border-b border-slate-200 bg-slate-50 p-3 sm:grid-cols-3 sm:p-4">
      <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3.5 py-2.5">
        <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-800">{copy.confirmedPins}</p>
        <p className="mt-0.5 text-2xl font-bold tabular-nums text-emerald-950">{confirmedCount}</p>
      </div>
      <div className="rounded-xl border border-amber-100 bg-amber-50 px-3.5 py-2.5">
        <p className="text-[11px] font-bold uppercase tracking-wide text-amber-800">{copy.candidatePins}</p>
        <p className="mt-0.5 text-2xl font-bold tabular-nums text-amber-950">{candidateCount}</p>
      </div>
      <div className="rounded-xl border border-brand-100 bg-brand-50 px-3.5 py-2.5">
        <p className="text-[11px] font-bold uppercase tracking-wide text-brand-800">{copy.locationsWithoutCoordinates}</p>
        <p className="mt-0.5 text-2xl font-bold tabular-nums text-brand-950">{unpinnedIds.size}</p>
      </div>
    </div>

    {!storageReady && <p className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-5 text-amber-950" role="status">
      {storageLoading ? <LoaderCircle className="mt-0.5 h-4 w-4 shrink-0 animate-spin" aria-hidden="true" /> : <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
      <span>{storageLoading ? copy.loadingPins : copy.pinStorageUnavailable}</span>
    </p>}

    <div className={`${styles.mapFrame} relative`}>
      <div ref={mapNodeRef} className={styles.mapCanvas} role="application" aria-label={copy.interactiveMapLabel} />
      {!mapReady && <div className="absolute inset-0 z-[450] flex items-center justify-center bg-slate-100/95 text-sm font-semibold text-slate-600" role="status">
        {mapFailed ? copy.mapLoadError : <span className="inline-flex items-center gap-2"><LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />{copy.loadingMap}</span>}
      </div>}
      {picking && <p className="absolute left-3 right-3 top-3 z-[500] mx-auto flex max-w-md items-center justify-center gap-2 rounded-xl border border-brand-200 bg-white/95 px-3 py-2.5 text-center text-sm font-bold text-brand-900 shadow-lg">
        <Crosshair className="h-4 w-4 shrink-0" aria-hidden="true" />{copy.clickMapToChoose}
      </p>}
      {selectedMarker && selectedMarkerUrl && <div className="absolute inset-x-3 bottom-12 z-[500] rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-xl backdrop-blur md:hidden">
        <button type="button" aria-label={copy.closeMapDetails} onClick={() => setSelectedMapPin(null)} className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100">×</button>
        <p className="pr-9 font-bold text-slate-950">{getLocationDisplayName(selectedMarker, language)}</p>
        <p className="mt-1 line-clamp-2 text-sm leading-5 text-slate-600">{selectedMarker.address}</p>
        {(selectedMarker.dispatch_restriction ?? getDispatchRestriction(selectedMarker)) && <p className="mt-2 text-xs font-semibold leading-4 text-rose-800">{selectedMarker.dispatch_restriction ?? getDispatchRestriction(selectedMarker)}</p>}
        <a href={selectedMarkerUrl} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg bg-brand-700 px-3 text-sm font-bold text-white" onClick={() => { onMarkUsed(selectedMarker); setSelectedMapPin(null); }}><MapPin className="h-4 w-4" aria-hidden="true" />{copy.map}<ArrowUpRight className="h-4 w-4" aria-hidden="true" /></a>
      </div>}
    </div>

    <div className="border-b border-slate-100 px-4 py-3 text-xs leading-5 text-slate-500 sm:px-5">
      <p>{copy.mapTileNotice}</p>
      <p className="mt-1">{copy.mapAttribution}: <a className="font-semibold text-brand-700 underline underline-offset-2" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a></p>
    </div>

    {canEdit && <div id="location-pin-editor" className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <div>
        <p className="text-sm font-bold text-slate-900">{copy.manualPinTitle}</p>
        <p className="mt-1 text-sm leading-5 text-slate-600">{copy.manualPinDescription}</p>
      </div>
      <div className="grid gap-3">
        <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
          <span>{copy.pinLocationLabel}</span>
          <select value={selectedLocationId} onChange={(event) => onSelectedLocationChange(event.target.value)} className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100">
            <option value="">{copy.chooseLocation}</option>
            {locations.map((location) => <option key={location.id} value={location.id}>{getLocationDisplayName(location, language)} · {location.address}</option>)}
          </select>
        </label>
        <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
          <span>{copy.pinTypeLabel}</span>
          <select value={pinType} onChange={(event) => onPinTypeChange(event.target.value as LocationPinType)} className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100">
            <option value="destination">{copy.destinationPin}</option>
            <option value="truck_entrance">{copy.truckEntrancePin}</option>
          </select>
        </label>
        {selectedEditorLocation && <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3">
          <p className="font-bold text-slate-900">{getLocationDisplayName(selectedEditorLocation, language)}</p>
          <p className="mt-1 whitespace-pre-line text-sm leading-5 text-slate-700">{selectedEditorLocation.address}</p>
          {(selectedEditorLocation.dispatch_restriction ?? getDispatchRestriction(selectedEditorLocation)) && <p className="mt-2 text-sm font-semibold leading-5 text-rose-800">{selectedEditorLocation.dispatch_restriction ?? getDispatchRestriction(selectedEditorLocation)}</p>}
        </div>}
        <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
          <span>{copy.coordinatesLabel}</span>
          <input value={coordinates} onChange={(event) => { setCoordinates(event.target.value); setCandidate(null); setSaveSucceeded(false); }} placeholder="13.7563, 100.5018" inputMode="decimal" autoComplete="off" className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-base outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" aria-invalid={coordinateError} aria-describedby={coordinateError ? "location-coordinates-error" : "location-coordinates-help"} />
          <span id="location-coordinates-help" className="text-xs font-normal leading-5 text-slate-500">{copy.coordinatesHelp}</span>
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={!selectedLocationId || !storageReady} onClick={() => { setPicking((current) => !current); setSaveError(false); setSaveSucceeded(false); }} className={`inline-flex min-h-10 items-center gap-2 rounded-xl border px-3 text-sm font-semibold transition ${picking ? "border-brand-300 bg-brand-100 text-brand-900" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"} disabled:cursor-not-allowed disabled:opacity-50`}><MousePointer2 className="h-4 w-4" aria-hidden="true" />{picking ? copy.cancel : copy.chooseOnMap}</button>
          <button type="button" disabled={!parseCoordinates(coordinates)} onClick={previewCoordinates} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-3 text-sm font-semibold text-brand-800 hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"><Crosshair className="h-4 w-4" aria-hidden="true" />{copy.previewCoordinate}</button>
        </div>
        {coordinateError && <p id="location-coordinates-error" className="text-xs font-semibold text-rose-700" role="alert">{copy.invalidCoordinates}</p>}
        {candidate && <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm leading-5 text-amber-950" role="status">{copy.candidatePreview}: <strong className="font-mono">{formatCoordinates(candidate)}</strong>. {copy.confirmBeforeSaving}</p>}
        <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
          <span>{copy.coordinateSourceLabel}</span>
          <input value={coordinateSource} onChange={(event) => { setCoordinateSource(event.target.value); setSaveSucceeded(false); }} maxLength={500} placeholder={copy.coordinateSourcePlaceholder} className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" />
        </label>
        <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
          <span>{copy.sourceReferenceLabel} <span className="font-normal text-slate-500">· {copy.optional}</span></span>
          <input type="url" value={sourceReference} onChange={(event) => { setSourceReference(event.target.value); setSaveSucceeded(false); }} maxLength={2048} placeholder={copy.sourceReferencePlaceholder} className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" />
        </label>
        {selectedPin && <p className="text-xs leading-5 text-slate-500">{copy.currentPinConfirmed}: {new Date(selectedPin.confirmed_at).toLocaleString(language === "th" ? "th-TH" : "en-GB", { dateStyle: "medium", timeStyle: "short" })}</p>}
        {saveError && <p className="text-sm font-semibold text-rose-700" role="alert">{copy.pinSaveError}</p>}
        {saveSucceeded && <p className="text-sm font-semibold text-emerald-700" role="status">{copy.pinSaveSuccess}</p>}
        <button type="button" disabled={!candidate || !selectedLocationId || !coordinateSource.trim() || !canEdit || !storageReady || saving} onClick={() => void confirmAndSave()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand-700 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-brand-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-50">
          {saving && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />}{copy.confirmAndSavePin}
        </button>
      </div>
    </div>}

    {!canEdit && <p className="border-t border-slate-100 px-4 py-4 text-sm leading-5 text-slate-600">{copy.pinReadOnly}</p>}

  </section>;
}
