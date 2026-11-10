/**
 * Read-only Forth GPS saved-location helpers for Fleet Tracking.
 * Coordinates come from the bundled Forth CSV and are labelled Forth GPS — not office-verified.
 */

import {
  FORTH_BUNDLED_EXPORT_COUNT,
  FORTH_GPS_SOURCE_LABEL,
  validateBundledForthMappingSource,
  type ForthMappingSourceValidation
} from "@/lib/forth-selected-locations";
import type { ForthPinnedLocationRecord } from "@/lib/forth-locations-import";

export type ForthGpsMapLocation = {
  id: string;
  forthLocationId: string;
  name: string;
  thaiName: string | null;
  groupLayer: string | null;
  address: string | null;
  locationType: string | null;
  diameterRaw: string | null;
  latitude: number;
  longitude: number;
  sourceLabel: typeof FORTH_GPS_SOURCE_LABEL;
  googleMapsUrl: string;
  matchedEesLocationId: string | null;
  matchConfidence: string | null;
  pinKind: "forth_gps";
};

export type ForthGpsMapPayload = {
  sourcePath: string;
  sourceLabel: typeof FORTH_GPS_SOURCE_LABEL;
  validation: ForthMappingSourceValidation;
  locations: ForthGpsMapLocation[];
  groups: string[];
  directoryPreservedNote: string;
};

function mapsUrl(latitude: number, longitude: number, name: string) {
  const query = encodeURIComponent(`${name} ${latitude},${longitude}`);
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

export function toForthGpsMapLocation(
  record: ForthPinnedLocationRecord,
  options?: { matchedEesLocationId?: string | null; matchConfidence?: string | null }
): ForthGpsMapLocation | null {
  if (record.latitude == null || record.longitude == null) return null;
  if (!Number.isFinite(record.latitude) || !Number.isFinite(record.longitude)) return null;
  const name = record.name?.trim() || `Forth ${record.forthLocationId}`;
  return {
    id: `forth:${record.forthLocationId}`,
    forthLocationId: record.forthLocationId,
    name,
    thaiName: record.name?.trim() || null,
    groupLayer: record.groupLayer,
    address: record.address,
    locationType: record.locationType,
    diameterRaw: record.diameterRaw,
    latitude: record.latitude,
    longitude: record.longitude,
    sourceLabel: FORTH_GPS_SOURCE_LABEL,
    googleMapsUrl: mapsUrl(record.latitude, record.longitude, name),
    matchedEesLocationId: options?.matchedEesLocationId ?? null,
    matchConfidence: options?.matchConfidence ?? null,
    pinKind: "forth_gps"
  };
}

export function buildForthGpsMapPayloadFromCsv(
  csvText: string,
  options?: {
    sourcePath?: string;
    matchByForthId?: ReadonlyMap<string, { eesLocationId: string; confidence: string | null }>;
  }
): ForthGpsMapPayload {
  const validation = validateBundledForthMappingSource(csvText);
  if (validation.status !== "ready") {
    return {
      sourcePath: options?.sourcePath ?? "data/forth-locations/Locations Forth Pinned.csv",
      sourceLabel: FORTH_GPS_SOURCE_LABEL,
      validation,
      locations: [],
      groups: [],
      directoryPreservedNote: "Existing EES Directory records are untouched; Forth GPS layer failed validation."
    };
  }

  const locations: ForthGpsMapLocation[] = [];
  for (const record of validation.records) {
    const match = options?.matchByForthId?.get(record.forthLocationId);
    const mapped = toForthGpsMapLocation(record, {
      matchedEesLocationId: match?.eesLocationId ?? null,
      matchConfidence: match?.confidence ?? null
    });
    if (mapped) locations.push(mapped);
  }

  const groups = [...new Set(locations.map((location) => location.groupLayer).filter(Boolean) as string[])]
    .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));

  return {
    sourcePath: options?.sourcePath ?? "data/forth-locations/Locations Forth Pinned.csv",
    sourceLabel: FORTH_GPS_SOURCE_LABEL,
    validation,
    locations,
    groups,
    directoryPreservedNote:
      `Forth GPS layer exposes ${locations.length} saved destinations for map display only. ` +
      `Existing Directory records remain separate. Expected export count ${FORTH_BUNDLED_EXPORT_COUNT}.`
  };
}

export function filterForthGpsMapLocations(
  locations: readonly ForthGpsMapLocation[],
  options: { search?: string; group?: string } = {}
) {
  const search = options.search?.trim().toLocaleLowerCase() ?? "";
  const group = options.group?.trim() ?? "";
  return locations.filter((location) => {
    if (group && location.groupLayer !== group) return false;
    if (!search) return true;
    return [
      location.name,
      location.thaiName,
      location.forthLocationId,
      location.groupLayer,
      location.address,
      location.locationType
    ].some((value) => value?.toLocaleLowerCase().includes(search));
  });
}

/**
 * V21.2 map paint policy: full Forth pin set only when the layer is on;
 * otherwise paint at most the focused search/selection pin.
 */
export function selectForthMapPaintLocations<T extends { id: string }>(
  locations: readonly T[],
  options: { layerOn: boolean; selectedId: string | null }
): T[] {
  if (options.layerOn) return [...locations];
  if (!options.selectedId) return [];
  const selected = locations.find((location) => location.id === options.selectedId);
  return selected ? [selected] : [];
}

/** Office-confirmed depot / office Directory pins for the optional overlay. */
export function isEesDepotOrOfficeCategory(category: string | null | undefined) {
  const value = (category ?? "").trim().toLowerCase();
  return value === "depot" || value === "office";
}
