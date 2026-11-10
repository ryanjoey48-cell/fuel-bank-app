/**
 * Forth saved-location selection / mapping-source validation.
 * Owner confirmed (2026-11-02): map ALL 466 rows from the bundled CSV.
 * The previous 403-selection gate is superseded.
 */

import {
  parseForthPinnedLocationsCsv,
  type ForthPinnedLocationRecord
} from "@/lib/forth-locations-import";

export const FORTH_OWNER_APPROVED_MAPPING_COUNT = 466;
export const FORTH_BUNDLED_EXPORT_COUNT = 466;
export const FORTH_GPS_SOURCE_LABEL = "Forth GPS";

/** @deprecated Owner superseded 403; use FORTH_OWNER_APPROVED_MAPPING_COUNT. */
export const FORTH_OWNER_REQUESTED_SELECTION_COUNT = FORTH_OWNER_APPROVED_MAPPING_COUNT;

export type ForthMappingSourceValidation =
  | {
      status: "invalid_source";
      bundledCount: number;
      uniqueIds: number;
      validCoordinatePairs: number;
      duplicateIds: string[];
      invalidCoordinateIds: string[];
      message: string;
    }
  | {
      status: "ready";
      bundledCount: number;
      uniqueIds: number;
      validCoordinatePairs: number;
      records: ForthPinnedLocationRecord[];
      message: string;
    };

export type ForthSelectionValidation =
  | {
      status: "missing_selection";
      bundledCount: number;
      requestedCount: number;
      message: string;
    }
  | {
      status: "invalid_selection";
      bundledCount: number;
      requestedCount: number;
      providedCount: number;
      unknownIds: string[];
      duplicateIds: string[];
      message: string;
    }
  | {
      status: "ready";
      bundledCount: number;
      requestedCount: number;
      selectedCount: number;
      selectedIds: string[];
      records: ForthPinnedLocationRecord[];
      excludedCount: number;
      message: string;
    };

export function parseForthSelectionIds(text: string): {
  ids: string[];
  duplicateIds: string[];
} {
  const seen = new Set<string>();
  const duplicateIds: string[] = [];
  const ids: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/^\uFEFF/, "").trim();
    if (!line || line.startsWith("#")) continue;
    if (seen.has(line)) {
      duplicateIds.push(line);
      continue;
    }
    seen.add(line);
    ids.push(line);
  }
  return { ids, duplicateIds };
}

/**
 * Validate the bundled Forth CSV as the approved full mapping set (466).
 * Fails clearly if count, uniqueness or coordinates differ.
 */
export function validateBundledForthMappingSource(csvText: string): ForthMappingSourceValidation {
  const records = parseForthPinnedLocationsCsv(csvText);
  const ids = records.map((record) => record.forthLocationId);
  const seen = new Set<string>();
  const duplicateIds: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) duplicateIds.push(id);
    else seen.add(id);
  }
  const invalidCoordinateIds = records
    .filter((record) => record.latitude == null || record.longitude == null
      || !Number.isFinite(record.latitude) || !Number.isFinite(record.longitude)
      || record.latitude < -90 || record.latitude > 90
      || record.longitude < -180 || record.longitude > 180)
    .map((record) => record.forthLocationId);
  const uniqueIds = seen.size;
  const validCoordinatePairs = records.length - invalidCoordinateIds.length;

  if (
    records.length !== FORTH_OWNER_APPROVED_MAPPING_COUNT
    || uniqueIds !== FORTH_OWNER_APPROVED_MAPPING_COUNT
    || validCoordinatePairs !== FORTH_OWNER_APPROVED_MAPPING_COUNT
    || duplicateIds.length > 0
    || invalidCoordinateIds.length > 0
  ) {
    return {
      status: "invalid_source",
      bundledCount: records.length,
      uniqueIds,
      validCoordinatePairs,
      duplicateIds: [...new Set(duplicateIds)],
      invalidCoordinateIds,
      message:
        `Forth mapping source must contain exactly ${FORTH_OWNER_APPROVED_MAPPING_COUNT} unique IDs with valid coordinates. ` +
        `Found records=${records.length}, uniqueIds=${uniqueIds}, validCoords=${validCoordinatePairs}.`
    };
  }

  return {
    status: "ready",
    bundledCount: records.length,
    uniqueIds,
    validCoordinatePairs,
    records,
    message: `Forth mapping source ready: ${records.length} unique locations with preserved Forth coordinates.`
  };
}

/**
 * Optional subset validation (defaults to the approved full 466 set).
 * Prefer validateBundledForthMappingSource for the owner-approved map layer.
 */
export function validateForthOwnerSelection(input: {
  csvText: string;
  selectionText: string | null | undefined;
  requestedCount?: number;
}): ForthSelectionValidation {
  const requestedCount = input.requestedCount ?? FORTH_OWNER_APPROVED_MAPPING_COUNT;
  const source = validateBundledForthMappingSource(input.csvText);
  if (source.status !== "ready") {
    return {
      status: "invalid_selection",
      bundledCount: source.bundledCount,
      requestedCount,
      providedCount: 0,
      unknownIds: [],
      duplicateIds: source.duplicateIds,
      message: source.message
    };
  }

  const byId = new Map(source.records.map((record) => [record.forthLocationId, record]));

  // Empty selection with approved full-set request ⇒ use all bundled rows.
  if (input.selectionText == null || !String(input.selectionText).trim()) {
    if (requestedCount === FORTH_OWNER_APPROVED_MAPPING_COUNT) {
      return {
        status: "ready",
        bundledCount: source.bundledCount,
        requestedCount,
        selectedCount: source.records.length,
        selectedIds: source.records.map((record) => record.forthLocationId),
        records: source.records,
        excludedCount: 0,
        message: source.message
      };
    }
    return {
      status: "missing_selection",
      bundledCount: source.bundledCount,
      requestedCount,
      message:
        `Bundled Forth export has ${source.bundledCount} rows; requested ${requestedCount}. ` +
        "Provide an explicit ID list for a subset, or request the full approved 466 set."
    };
  }

  const { ids, duplicateIds } = parseForthSelectionIds(input.selectionText);
  const unknownIds = ids.filter((id) => !byId.has(id));
  const providedCount = ids.length;

  if (
    providedCount !== requestedCount
    || unknownIds.length > 0
    || duplicateIds.length > 0
  ) {
    return {
      status: "invalid_selection",
      bundledCount: source.bundledCount,
      requestedCount,
      providedCount,
      unknownIds,
      duplicateIds,
      message:
        `Selection must contain exactly ${requestedCount} unique Forth IDs that exist in the bundled export. ` +
        `Received ${providedCount} unique IDs` +
        (unknownIds.length ? `, ${unknownIds.length} unknown` : "") +
        (duplicateIds.length ? `, ${duplicateIds.length} duplicates` : "") +
        "."
    };
  }

  const selected = ids.map((id) => byId.get(id)!);
  return {
    status: "ready",
    bundledCount: source.bundledCount,
    requestedCount,
    selectedCount: selected.length,
    selectedIds: ids,
    records: selected,
    excludedCount: source.bundledCount - selected.length,
    message: `Selection ready: ${selected.length} Forth locations; ${source.bundledCount - selected.length} excluded.`
  };
}
