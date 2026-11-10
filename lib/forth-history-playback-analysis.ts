/**
 * Read-only historical customer proximity against saved Forth pins.
 * Never confirms arrivals, never writes events, never enables geofences.
 */

import {
  FORTH_LOCATION_APPROACHING_METERS,
  FORTH_LOCATION_AT_METERS,
  classifyForthLocationProximityBand,
  type ForthLocationProximityBand
} from "@/lib/forth-location-proximity";
import type { HistoricalLogPoint } from "@/lib/forth-history-log";
import type { ForthGpsMapLocation } from "@/lib/forth-gps-map-locations";

const EARTH_RADIUS_M = 6_371_000;
/** Break a visit window when successive qualifying hits are farther apart than this. */
export const HISTORICAL_VISIT_WINDOW_GAP_MS = 5 * 60_000;

function haversineMeters(
  latitude: number,
  longitude: number,
  otherLatitude: number,
  otherLongitude: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(otherLatitude - latitude);
  const dLon = toRad(otherLongitude - longitude);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(latitude)) * Math.cos(toRad(otherLatitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

export type HistoricalCustomerHit = {
  locationId: string;
  forthLocationId: string;
  name: string;
  band: Exclude<ForthLocationProximityBand, "outside">;
  distanceMeters: number;
  observationIndex: number;
  timestampIso: string | null;
  verifiedGps: boolean;
};

export type HistoricalVisitGapQuality = "continuous" | "sparse" | "fragmented";

export type HistoricalCustomerVisitWindow = {
  locationId: string;
  forthLocationId: string;
  name: string;
  observationCount: number;
  atLocationCount: number;
  approachingCount: number;
  firstTimestampIso: string | null;
  lastTimestampIso: string | null;
  /** Duration only when ≥2 timestamps exist inside this window — not arrival/departure. */
  durationMs: number | null;
  nearestDistanceMeters: number;
  gapQuality: HistoricalVisitGapQuality;
  maxInternalGapMs: number | null;
};

export type HistoricalCustomerVisitCandidate = HistoricalCustomerVisitWindow;

function isPlottableVerified(point: HistoricalLogPoint): boolean {
  return (
    point.verifiedGps &&
    point.coordinateStatus === "valid" &&
    typeof point.latitude === "number" &&
    typeof point.longitude === "number" &&
    Number.isFinite(point.latitude) &&
    Number.isFinite(point.longitude)
  );
}

function parseHitTimeMs(hit: HistoricalCustomerHit): number | null {
  if (!hit.timestampIso) return null;
  const ms = Date.parse(hit.timestampIso);
  return Number.isFinite(ms) ? ms : null;
}

function classifyGapQuality(
  observationCount: number,
  maxInternalGapMs: number | null,
  windowGapMs: number
): HistoricalVisitGapQuality {
  if (observationCount < 2 || maxInternalGapMs == null) return "continuous";
  if (maxInternalGapMs <= windowGapMs / 2) return "continuous";
  if (maxInternalGapMs <= windowGapMs) return "sparse";
  return "fragmented";
}

/** Hits within 200 m of a selected customer for review — verified GPS only. */
export function findHistoricalHitsNearCustomer(
  points: readonly HistoricalLogPoint[],
  location: Pick<ForthGpsMapLocation, "id" | "forthLocationId" | "name" | "latitude" | "longitude">,
  options?: { atMeters?: number; approachingMeters?: number }
): HistoricalCustomerHit[] {
  const atMeters = options?.atMeters ?? FORTH_LOCATION_AT_METERS;
  const approachingMeters = options?.approachingMeters ?? FORTH_LOCATION_APPROACHING_METERS;
  const hits: HistoricalCustomerHit[] = [];
  points.forEach((point, observationIndex) => {
    if (!isPlottableVerified(point)) return;
    const distanceMeters = haversineMeters(
      point.latitude!,
      point.longitude!,
      location.latitude,
      location.longitude
    );
    const band = classifyForthLocationProximityBand(distanceMeters, { atLocationMeters: atMeters, approachingMeters });
    if (band === "outside") return;
    hits.push({
      locationId: location.id,
      forthLocationId: location.forthLocationId,
      name: location.name,
      band,
      distanceMeters,
      observationIndex,
      timestampIso: point.timestampIso,
      verifiedGps: true
    });
  });
  return hits;
}

/**
 * Group consecutive qualifying hits into visit windows.
 * A new window starts when observation indices are non-adjacent or the time gap exceeds the threshold.
 * Does not invent arrival/departure — duration is evidenced span only.
 */
export function groupHistoricalVisitWindows(
  hits: readonly HistoricalCustomerHit[],
  options?: { windowGapMs?: number; minObservations?: number }
): HistoricalCustomerVisitWindow[] {
  const windowGapMs = options?.windowGapMs ?? HISTORICAL_VISIT_WINDOW_GAP_MS;
  const minObservations = options?.minObservations ?? 2;
  if (!hits.length) return [];

  const ordered = [...hits].sort(
    (left, right) =>
      left.observationIndex - right.observationIndex ||
      (parseHitTimeMs(left) ?? 0) - (parseHitTimeMs(right) ?? 0)
  );

  const groups: HistoricalCustomerHit[][] = [];
  let current: HistoricalCustomerHit[] = [];

  for (const hit of ordered) {
    if (!current.length) {
      current = [hit];
      continue;
    }
    const previous = current[current.length - 1]!;
    const previousTime = parseHitTimeMs(previous);
    const hitTime = parseHitTimeMs(hit);
    const indexGap = hit.observationIndex - previous.observationIndex;
    const timeGap =
      previousTime != null && hitTime != null ? Math.max(0, hitTime - previousTime) : null;
    const adjacentIndex = indexGap <= 1;
    const withinTime = timeGap == null || timeGap <= windowGapMs;
    if (adjacentIndex && withinTime) {
      current.push(hit);
    } else {
      groups.push(current);
      current = [hit];
    }
  }
  if (current.length) groups.push(current);

  const windows: HistoricalCustomerVisitWindow[] = [];
  for (const group of groups) {
    if (group.length < minObservations) continue;
    const first = group[0]!;
    const times = group
      .map((hit) => parseHitTimeMs(hit))
      .filter((ms): ms is number => ms != null)
      .sort((a, b) => a - b);
    let maxInternalGapMs: number | null = null;
    for (let index = 1; index < times.length; index += 1) {
      const gap = times[index]! - times[index - 1]!;
      maxInternalGapMs = maxInternalGapMs == null ? gap : Math.max(maxInternalGapMs, gap);
    }
    const durationMs = times.length >= 2 ? Math.max(0, times[times.length - 1]! - times[0]!) : null;
    windows.push({
      locationId: first.locationId,
      forthLocationId: first.forthLocationId,
      name: first.name,
      observationCount: group.length,
      atLocationCount: group.filter((hit) => hit.band === "at_location").length,
      approachingCount: group.filter((hit) => hit.band === "approaching").length,
      firstTimestampIso: times.length ? new Date(times[0]!).toISOString() : null,
      lastTimestampIso: times.length ? new Date(times[times.length - 1]!).toISOString() : null,
      durationMs,
      nearestDistanceMeters: Math.min(...group.map((hit) => hit.distanceMeters)),
      gapQuality: classifyGapQuality(group.length, maxInternalGapMs, windowGapMs),
      maxInternalGapMs
    });
  }
  return windows;
}

/**
 * Candidate stops near any of the provided destinations.
 * Windows require enough verified observations; duration only with start/end evidence.
 */
export function summarizeHistoricalVisitCandidates(
  points: readonly HistoricalLogPoint[],
  locations: readonly Pick<ForthGpsMapLocation, "id" | "forthLocationId" | "name" | "latitude" | "longitude">[],
  options?: {
    atMeters?: number;
    approachingMeters?: number;
    minObservations?: number;
    windowGapMs?: number;
  }
): HistoricalCustomerVisitCandidate[] {
  const minObservations = options?.minObservations ?? 2;
  const candidates: HistoricalCustomerVisitCandidate[] = [];
  for (const location of locations) {
    const hits = findHistoricalHitsNearCustomer(points, location, options);
    const windows = groupHistoricalVisitWindows(hits, {
      minObservations,
      windowGapMs: options?.windowGapMs
    });
    candidates.push(...windows);
  }
  return candidates.sort(
    (left, right) =>
      left.nearestDistanceMeters - right.nearestDistanceMeters ||
      right.observationCount - left.observationCount ||
      (right.durationMs ?? 0) - (left.durationMs ?? 0)
  );
}
