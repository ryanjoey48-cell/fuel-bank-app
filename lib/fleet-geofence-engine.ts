/** Pure geofence transitions. Coordinates and timestamps are evidence, not inferred trips. */
export type GeofencePhase = "OUTSIDE" | "ENTRY_CANDIDATE" | "INSIDE" | "EXIT_CANDIDATE" | "DEPARTED" | "UNCERTAIN";
export type GeofenceStableState = "OUTSIDE" | "INSIDE";
export type GeofenceEventType = "arrival" | "departure";

export type ApprovedGeofence = {
  locationId: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  entryDwellMs: number;
  exitDwellMs: number;
  hysteresisMeters: number;
  active: boolean;
};

export type GeofenceObservation = {
  vehicleKey: string;
  registration: string | null;
  sourceAt: string | null;
  detectedAt: string;
  latitude: number | null;
  longitude: number | null;
  gpsVerified: boolean;
  trackerConnected: boolean;
};

export type VehicleGeofenceState = {
  vehicleKey: string;
  phase: GeofencePhase;
  stable: GeofenceStableState;
  locationId: string | null;
  candidateSince: string | null;
  arrivalAt: string | null;
  visitKey: string | null;
  lastSourceAt: string | null;
  lastDetectedAt: string | null;
  uncertainReason: string | null;
};

export type GeofenceVisitEvent = {
  eventKey: string;
  visitKey: string;
  type: GeofenceEventType;
  vehicleKey: string;
  registration: string | null;
  locationId: string;
  occurredAt: string;
  confirmedSourceAt: string;
  confirmedLatitude: number;
  confirmedLongitude: number;
  detectedAt: string;
  durationSeconds: number | null;
  evidence: "verified_forth_gps";
};

export type GeofenceTransition = {
  state: VehicleGeofenceState;
  events: GeofenceVisitEvent[];
  ignored: "duplicate_or_out_of_order" | null;
};

export type GeofenceEvaluateOptions = {
  maxObservationAgeMs?: number;
  maxFutureSkewMs?: number;
  /**
   * Maximum allowed gap between consecutive verified source observations while a dwell
   * candidate is open, or while confirming that dwell. A 09:00 sample and an 11:00 sample
   * cannot alone confirm continuous presence. Default 5 minutes.
   */
  maxDwellObservationGapMs?: number;
};

export const DEFAULT_MAX_DWELL_OBSERVATION_GAP_MS = 5 * 60_000;

export function initialVehicleGeofenceState(vehicleKey: string): VehicleGeofenceState {
  return { vehicleKey, phase: "OUTSIDE", stable: "OUTSIDE", locationId: null, candidateSince: null,
    arrivalAt: null, visitKey: null, lastSourceAt: null, lastDetectedAt: null, uncertainReason: null };
}

export function validGeofenceCoordinates(latitude: unknown, longitude: unknown): latitude is number {
  return typeof latitude === "number" && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 &&
    typeof longitude === "number" && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
}

export function geofenceDistanceMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const deltaLat = radians(b.latitude - a.latitude);
  const deltaLon = radians(b.longitude - a.longitude);
  const h = Math.sin(deltaLat / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(deltaLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

function validZone(zone: ApprovedGeofence): boolean {
  return Boolean(zone.active && zone.locationId && validGeofenceCoordinates(zone.latitude, zone.longitude) &&
    Number.isFinite(zone.radiusMeters) && zone.radiusMeters > 0 && zone.radiusMeters <= 5000 &&
    Number.isFinite(zone.entryDwellMs) && zone.entryDwellMs >= 0 &&
    Number.isFinite(zone.exitDwellMs) && zone.exitDwellMs >= 0 &&
    Number.isFinite(zone.hysteresisMeters) && zone.hysteresisMeters >= 0 && zone.hysteresisMeters <= zone.radiusMeters);
}

function uncertain(previous: VehicleGeofenceState, observation: GeofenceObservation, reason: string): VehicleGeofenceState {
  const sourceMs = Date.parse(observation.sourceAt ?? "");
  const detectedMs = Date.parse(observation.detectedAt);
  const safeSourceAt = Number.isFinite(sourceMs) && Number.isFinite(detectedMs) && sourceMs <= detectedMs + 60_000
    ? observation.sourceAt : previous.lastSourceAt;
  return { ...previous, phase: "UNCERTAIN", candidateSince: null, uncertainReason: reason,
    lastSourceAt: safeSourceAt, lastDetectedAt: observation.detectedAt };
}

function observationGapExceeded(
  previousSourceAt: string | null,
  currentSourceMs: number,
  maxGapMs: number
): boolean {
  const previousMs = Date.parse(previousSourceAt ?? "");
  if (!Number.isFinite(previousMs)) return false;
  return currentSourceMs - previousMs > maxGapMs;
}

/** One call processes one source observation. The caller persists state and events atomically. */
export function evaluateVehicleGeofences(
  previous: VehicleGeofenceState,
  observation: GeofenceObservation,
  zones: readonly ApprovedGeofence[],
  options: GeofenceEvaluateOptions = {}
): GeofenceTransition {
  if (previous.vehicleKey !== observation.vehicleKey) throw new Error("Vehicle state and observation identity differ.");
  const maxAge = options.maxObservationAgeMs ?? 15 * 60_000;
  const maxFuture = options.maxFutureSkewMs ?? 60_000;
  const maxGap = options.maxDwellObservationGapMs ?? DEFAULT_MAX_DWELL_OBSERVATION_GAP_MS;
  const sourceMs = Date.parse(observation.sourceAt ?? "");
  const detectedMs = Date.parse(observation.detectedAt);
  const previousMs = Date.parse(previous.lastSourceAt ?? "");
  if (Number.isFinite(sourceMs) && Number.isFinite(previousMs) && sourceMs <= previousMs &&
    !(sourceMs === previousMs && Number.isFinite(detectedMs) && detectedMs - sourceMs > maxAge)) {
    return { state: previous, events: [], ignored: "duplicate_or_out_of_order" };
  }
  const noEvidence = !Number.isFinite(sourceMs) || !Number.isFinite(detectedMs) ||
    sourceMs > detectedMs + maxFuture ||
    detectedMs - sourceMs > maxAge ||
    !observation.trackerConnected || !observation.gpsVerified ||
    !validGeofenceCoordinates(observation.latitude, observation.longitude);
  if (noEvidence) {
    const reason = !observation.trackerConnected ? "tracker_offline" : !observation.gpsVerified ? "gps_unverified" :
      !validGeofenceCoordinates(observation.latitude, observation.longitude) ? "coordinates_unavailable" : "source_time_unreliable";
    const next = uncertain(previous, observation, reason);
    if (previous.phase === "UNCERTAIN" && previous.uncertainReason === reason && next.lastSourceAt === previous.lastSourceAt) {
      return { state: previous, events: [], ignored: "duplicate_or_out_of_order" };
    }
    return { state: next, events: [], ignored: null };
  }

  const usable = zones.filter(validZone);
  const point = { latitude: observation.latitude as number, longitude: observation.longitude as number };
  const current = previous.locationId ? usable.find((zone) => zone.locationId === previous.locationId) : undefined;
  if (previous.stable === "INSIDE" && !current) {
    return { state: uncertain(previous, observation, "approved_zone_unavailable"), events: [], ignored: null };
  }
  const currentDistance = current ? geofenceDistanceMeters(point, current) : Number.POSITIVE_INFINITY;
  const base = { ...previous, lastSourceAt: observation.sourceAt, lastDetectedAt: observation.detectedAt, uncertainReason: null };
  const gapBroken = observationGapExceeded(previous.lastSourceAt, sourceMs, maxGap);

  if (previous.stable === "INSIDE" && current) {
    if (!previous.visitKey || !previous.arrivalAt) {
      return { state: uncertain(previous, observation, "visit_state_incomplete"), events: [], ignored: null };
    }
    // Long gaps while already inside do not invent a departure; they also do not prove continuous presence.
    if (currentDistance <= current.radiusMeters + current.hysteresisMeters) {
      if (gapBroken && previous.phase === "EXIT_CANDIDATE") {
        return { state: { ...base, phase: "INSIDE", candidateSince: null }, events: [], ignored: null };
      }
      return { state: { ...base, phase: "INSIDE", candidateSince: null }, events: [], ignored: null };
    }
    const continuingExit = previous.phase === "EXIT_CANDIDATE" && previous.candidateSince !== null && !gapBroken;
    const candidateSince = continuingExit ? previous.candidateSince! : observation.sourceAt!;
    if (!continuingExit || sourceMs - Date.parse(candidateSince) < current.exitDwellMs) {
      return { state: { ...base, phase: "EXIT_CANDIDATE", candidateSince }, events: [], ignored: null };
    }
    // Confirm exit only when consecutive verified samples bridged the dwell without an oversized gap.
    if (gapBroken) {
      return { state: { ...base, phase: "EXIT_CANDIDATE", candidateSince: observation.sourceAt! }, events: [], ignored: null };
    }
    const event: GeofenceVisitEvent = {
      eventKey: `${previous.visitKey}:departure`, visitKey: previous.visitKey, type: "departure",
      vehicleKey: observation.vehicleKey, registration: observation.registration, locationId: current.locationId,
      occurredAt: candidateSince, confirmedSourceAt: observation.sourceAt!, detectedAt: observation.detectedAt,
      confirmedLatitude: point.latitude, confirmedLongitude: point.longitude,
      durationSeconds: previous.arrivalAt ? Math.max(0, Math.floor((Date.parse(candidateSince) - Date.parse(previous.arrivalAt)) / 1000)) : null,
      evidence: "verified_forth_gps"
    };
    return { state: { ...base, phase: "DEPARTED", stable: "OUTSIDE", locationId: null, candidateSince: null,
      arrivalAt: null, visitKey: null }, events: [event], ignored: null };
  }

  // In overlapping zones one nearest normalized position wins; an existing candidate remains preferred while valid.
  const candidates = usable.map((zone) => ({ zone, distance: geofenceDistanceMeters(point, zone) }))
    .filter(({ zone, distance }) => distance <= zone.radiusMeters)
    .sort((a, b) => a.distance / a.zone.radiusMeters - b.distance / b.zone.radiusMeters || a.zone.locationId.localeCompare(b.zone.locationId));
  const priorCandidate = previous.phase === "ENTRY_CANDIDATE" && previous.locationId && !gapBroken
    ? candidates.find(({ zone }) => zone.locationId === previous.locationId) : undefined;
  const chosen = priorCandidate ?? candidates[0];
  if (!chosen) {
    return { state: { ...base, phase: "OUTSIDE", stable: "OUTSIDE", locationId: null, candidateSince: null,
      arrivalAt: null, visitKey: null }, events: [], ignored: null };
  }
  const candidateSince = priorCandidate && previous.candidateSince ? previous.candidateSince : observation.sourceAt!;
  if (!priorCandidate || sourceMs - Date.parse(candidateSince) < chosen.zone.entryDwellMs) {
    return { state: { ...base, phase: "ENTRY_CANDIDATE", stable: "OUTSIDE", locationId: chosen.zone.locationId,
      candidateSince, arrivalAt: null, visitKey: null }, events: [], ignored: null };
  }
  if (gapBroken) {
    // Dwell elapsed on the clock, but the observation gap is too large to treat presence as continuous.
    return { state: { ...base, phase: "ENTRY_CANDIDATE", stable: "OUTSIDE", locationId: chosen.zone.locationId,
      candidateSince: observation.sourceAt!, arrivalAt: null, visitKey: null }, events: [], ignored: null };
  }
  const visitKey = `${observation.vehicleKey}:${chosen.zone.locationId}:${candidateSince}`;
  const event: GeofenceVisitEvent = {
    eventKey: `${visitKey}:arrival`, visitKey, type: "arrival", vehicleKey: observation.vehicleKey,
    registration: observation.registration, locationId: chosen.zone.locationId, occurredAt: candidateSince,
    confirmedSourceAt: observation.sourceAt!, confirmedLatitude: point.latitude, confirmedLongitude: point.longitude,
    detectedAt: observation.detectedAt, durationSeconds: null,
    evidence: "verified_forth_gps"
  };
  return { state: { ...base, phase: "INSIDE", stable: "INSIDE", locationId: chosen.zone.locationId,
    candidateSince: null, arrivalAt: candidateSince, visitKey }, events: [event], ignored: null };
}
