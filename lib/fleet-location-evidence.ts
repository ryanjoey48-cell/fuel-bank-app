/**
 * V5 Stage B: stop evidence for the Locations Directory pin editor. Pure and read-only.
 * Turns one vehicle-day of observations into candidate stops the office can LOOK AT. It never saves, proposes or verifies a pin,
 * and it never says a stop belongs to a customer. Coordinates are returned only to callers the server has already authorised.
 */
import { DEFAULT_SEARCH_RADIUS_M, MAX_SEARCH_RADIUS_M, detectStopClusters, normaliseObservations, searchCandidateStops, type Coord, type StopCluster, type StopObservation } from "./fleet-stop-intelligence";
import { metersBetween } from "./fleet-job-movement";
import { mergeStopsIntoVisits } from "./fleet-visit-recognition";

export const MAX_EVIDENCE_CLUSTERS = 30;
export type LocationEvidenceStop = {
  centroid: Coord;
  firstAt: string; lastAt: string;
  observations: number;
  stayMinutes: { min: number; max: number | null };
  arrivalWindow: StopCluster["arrivalWindow"]; departureWindow: StopCluster["departureWindow"];
  sourceQuality: StopCluster["sourceQuality"];
  nextToTelemetryGap: boolean;
  distanceFromAnchorM: number | null;
  /** Adjacent stops at one place with a short interruption and continuous tracking form one visit (letter A, B, ...). null = stands alone. */
  visitLabel: string | null;
  visitStops: number;
  /** Evidence weight for sorting only (0 to 100). Not a probability, never a confirmation. */
  weight: number | null;
  notes: ("outside_the_150m_matching_radius" | "next_to_telemetry_gap" | "at_edge_of_day_data" | "positions_not_all_verified_gps" | "could_belong_to_a_neighbouring_site")[];
};
export type LocationEvidence = {
  mode: "near_anchor" | "whole_day";
  anchorProvided: boolean;
  searchRadiusM: number | null;
  observations: { total: number; verified: number; unverified: number };
  stops: LocationEvidenceStop[];
  anchorOnRoad: boolean;
  limitations: string[];
};

const minutes = (ms: number) => Math.round(ms / 60_000);
const toStop = (cluster: StopCluster, anchor: Coord | null, weight: number | null, extra: string[]): LocationEvidenceStop => {
  const notes: LocationEvidenceStop["notes"] = [];
  const distance = anchor ? Math.round(metersBetween(cluster.centroid, anchor)) : null;
  if (distance !== null && distance > 150) notes.push("outside_the_150m_matching_radius");
  // No earlier or later position at all means the stop touches the edge of the day's data (not a recording gap); a gap needs a position on the far side.
  const edge = cluster.beforeAt === null || cluster.afterAt === null;
  const realGap = (cluster.beforeAt !== null && cluster.gapBefore) || (cluster.afterAt !== null && cluster.gapAfter);
  if (edge) notes.push("at_edge_of_day_data");
  if (realGap) notes.push("next_to_telemetry_gap");
  if (cluster.sourceQuality !== "verified_gps") notes.push("positions_not_all_verified_gps");
  if (extra.includes("could_belong_to_a_neighbouring_site")) notes.push("could_belong_to_a_neighbouring_site");
  return { centroid: cluster.centroid, firstAt: cluster.firstAt, lastAt: cluster.lastAt, observations: cluster.observations, stayMinutes: { min: minutes(cluster.dwellMs.min), max: cluster.dwellMs.max === null ? null : minutes(cluster.dwellMs.max) },
    arrivalWindow: cluster.arrivalWindow, departureWindow: cluster.departureWindow, sourceQuality: cluster.sourceQuality, nextToTelemetryGap: realGap, distanceFromAnchorM: distance, visitLabel: null, visitStops: 1, weight, notes };
};

/**
 * With an anchor (an existing pin or an unreviewed booking coordinate): stops within a bounded search radius, ranked by evidence weight.
 * Without one (a site with no pin yet): the day's stops, longest stay first, so the office can browse them. Slow movement is excluded.
 */
export function buildLocationEvidence(input: { observations: readonly StopObservation[]; anchor?: Coord | null; searchRadiusM?: number }): LocationEvidence {
  const obs = normaliseObservations(input.observations);
  const verified = obs.filter(o => o.verified).length;
  const anchor = input.anchor && Number.isFinite(input.anchor.latitude) && Number.isFinite(input.anchor.longitude) && Math.abs(input.anchor.latitude) <= 90 && Math.abs(input.anchor.longitude) <= 180 ? input.anchor : null;
  const base = { observations: { total: obs.length, verified, unverified: obs.length - verified } };
  // Group adjacent stops into visits using the whole day, so a stay interrupted for a minute is not shown as two unrelated places.
  const groups = mergeStopsIntoVisits(detectStopClusters(obs), obs).filter(v => v.clusters.length > 1);
  const label = new Map<string, { letter: string; size: number }>();
  groups.forEach((v, i) => v.clusters.forEach(c => label.set(c.firstAt, { letter: String.fromCharCode(65 + (i % 26)), size: v.clusters.length })));
  const tag = (s: LocationEvidenceStop): LocationEvidenceStop => { const l = label.get(s.firstAt); return l ? { ...s, visitLabel: l.letter, visitStops: l.size } : s; };
  const limitations = ["Candidates are not customer sites until the office verifies a pin.", "Stops are inferred from positions about every 1 to 5 minutes; shorter stops can be missed.", "A stop is how long the vehicle stayed, not unloading time and not billable waiting time.", "One vehicle-day is weak evidence; repeat across vehicles and days before trusting a place."];
  if (!obs.length) limitations.push("No positions were available for this vehicle-day.");
  if (anchor) {
    const search = searchCandidateStops({ observations: obs, point: anchor, searchRadiusM: input.searchRadiusM ?? DEFAULT_SEARCH_RADIUS_M });
    return { mode: "near_anchor", anchorProvided: true, searchRadiusM: Math.min(search.searchRadiusM, MAX_SEARCH_RADIUS_M), ...base, anchorOnRoad: search.bookedPointOnRoad, limitations,
      stops: search.candidates.slice(0, MAX_EVIDENCE_CLUSTERS).map(c => tag(toStop(c.cluster, anchor, c.weight, c.reasons))) };
  }
  const clusters = detectStopClusters(obs).filter(c => c.kind === "stop").sort((a, b) => b.dwellMs.min - a.dwellMs.min).slice(0, MAX_EVIDENCE_CLUSTERS);
  return { mode: "whole_day", anchorProvided: false, searchRadiusM: null, ...base, anchorOnRoad: false, limitations, stops: clusters.map(c => tag(toStop(c, null, null, []))) };
}

/** Joins the cached provider day's two position lists into one ordered observation list (verified flag kept per position). */
export function observationsFromProviderDay(day: { observedPoints?: readonly { timestamp: string; latitude: number; longitude: number; speedKph?: number | null }[]; reportedPoints?: readonly { timestamp: string; latitude: number; longitude: number; speedKph?: number | null }[] } | null): StopObservation[] {
  if (!day) return [];
  const map = (verified: boolean) => (p: { timestamp: string; latitude: number; longitude: number; speedKph?: number | null }): StopObservation => ({ timestamp: p.timestamp, latitude: p.latitude, longitude: p.longitude, speedKph: p.speedKph ?? null, verified });
  return [...(day.observedPoints ?? []).map(map(true)), ...(day.reportedPoints ?? []).map(map(false))];
}
