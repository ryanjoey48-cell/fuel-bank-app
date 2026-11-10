/**
 * V5.4 automatic job visit recognition. Pure and read-only.
 *
 * Question answered for each booked job: which stops of this vehicle-day most plausibly are the pickup and the delivery visit,
 * and how sure are we? It never confirms anything. A prolonged stop near a booked place is evidence of a visit, not proof of
 * loading, unloading or completion; the output is always a ranked, explained suggestion for a person.
 *
 * Boundaries kept apart:
 *  - the 150 m DIRECT boundary (or a verified pin's own radius) is where a stop counts as at the site;
 *  - the SEARCH zone (default 600 m, hard cap 1000 m) is only for FINDING candidates around an unreviewed booking point. A candidate
 *    found there is "near the booked point", never "arrived", and the confidence is capped.
 * Tracking gaps are never stationary time. Adjacent stops are merged into one visit only with evidence (short interruption,
 * same place, continuous tracking); otherwise they stay separate. Two similar candidates are shown together, not decided.
 */
import { metersBetween } from "./fleet-job-movement";
import { detectStopClusters, findDriveBys, normaliseObservations, type Coord, type DriveBy, type StopCluster, type StopObservation } from "./fleet-stop-intelligence";

export const DIRECT_RADIUS_M = 150;
export const SEARCH_ZONE_UNVERIFIED_M = 600;
export const SEARCH_ZONE_MAX_M = 1000;
export const MERGE_MAX_INTERRUPTION_MS = 15 * 60_000;
export const MERGE_MAX_SEPARATION_M = 250;
export const COMPETITOR_MARGIN = 10;
const MIN_PROBABLE_WEIGHT = 60;
const SCHEDULE_EARLY_MS = 60 * 60_000;
const SCHEDULE_LATE_MS = 4 * 3_600_000;

export type VisitConfidence = "high" | "medium" | "low";
export type VisitSummaryClass = "probable_visit" | "possible_visit" | "competing_candidates" | "drive_by_rejected" | "no_reliable_evidence";
export type VisitReason =
  | "direct_boundary_stop" | "found_in_search_zone_only" | "long_stay" | "moderate_stay" | "short_stay" | "verified_gps_positions" | "mixed_positions" | "provider_reported_unverified_positions"
  | "windows_tight" | "arrival_or_departure_unknown" | "next_to_tracking_gap" | "touches_edge_of_day_data" | "merged_adjacent_stops" | "fits_scheduled_time" | "outside_scheduled_time" | "no_scheduled_time"
  | "unreviewed_booking_point" | "may_belong_to_neighbouring_site" | "competing_candidate" | "shared_with_another_job" | "follows_pickup" | "before_pickup" | "confidence_capped_unverified" | "confidence_capped_search_zone";
export type VisitAlternative = "loading_or_unloading_not_proven" | "queueing_or_waiting_outside_gate" | "rest_or_break" | "neighbouring_site" | "fuel_or_service_stop" | "unrelated_stop_on_route";

export type RecognisedVisit = {
  key: string;
  centroid: Coord;
  distanceFromPointM: number;
  zone: "direct" | "search";
  stops: number;
  arrival: { earliest: string | null; latest: string };
  departure: { earliest: string; latest: string | null };
  dwell: { minMinutes: number; maxMinutes: number | null; interruptions: number };
  sourceQuality: StopCluster["sourceQuality"];
  edgeOfDay: boolean; gap: boolean; tightWindows: boolean;
  /** Evidence weight for sorting, 0 to 100. Not a probability. */
  weight: number;
  confidence: VisitConfidence;
  reasons: VisitReason[];
  alternatives: VisitAlternative[];
};
export type RolePoint = { point: Coord | null; verified: boolean; radiusM: number };
export type RoleRecognition = {
  summary: VisitSummaryClass;
  searchZoneM: number;
  candidates: RecognisedVisit[];
  driveBys: DriveBy[];
  /** Long stops later in the day that are outside the zone. Listed for a person to look at; never matched. */
  otherLongStops: { centroid: Coord; firstAt: string; lastAt: string; dwellMinutes: number; distanceFromPointM: number; sourceQuality: StopCluster["sourceQuality"] }[];
  note: string;
};
export type JobRecognition = {
  version: "v5.4";
  pickup: RoleRecognition; delivery: RoleRecognition;
  sequence: "pickup_then_delivery_plausible" | "pickup_only" | "delivery_only" | "neither" | "order_conflict";
  /** Always algorithmic. Never an office confirmation. */
  algorithmic: true;
};

const ms = (iso: string) => Date.parse(iso);
const minutes = (v: number) => Math.round(v / 60_000);

type Visit = { clusters: StopCluster[]; first: StopCluster; last: StopCluster; interruptions: number };

/**
 * Merges stops into visits only with evidence: the same place (centroids within 250 m), a short interruption (15 minutes at most),
 * continuous tracking in between (no recording gap), and every position in between staying near the place. Anything else stays separate.
 */
export function mergeStopsIntoVisits(clusters: readonly StopCluster[], observations: readonly StopObservation[]): Visit[] {
  const obs = normaliseObservations(observations);
  const stops = clusters.filter(c => c.kind === "stop").sort((a, b) => ms(a.firstAt) - ms(b.firstAt));
  const visits: Visit[] = [];
  for (const stop of stops) {
    const current = visits.at(-1);
    if (current) {
      const prev = current.last, interruption = ms(stop.firstAt) - ms(prev.lastAt);
      const between = obs.filter(o => ms(o.timestamp) > ms(prev.lastAt) && ms(o.timestamp) < ms(stop.firstAt));
      const sameSpot = metersBetween(prev.centroid, stop.centroid) <= MERGE_MAX_SEPARATION_M && between.every(o => metersBetween(o, prev.centroid) <= MERGE_MAX_SEPARATION_M + 50);
      const continuous = stop.beforeAt !== null && !stop.gapBefore;
      if (interruption >= 0 && interruption <= MERGE_MAX_INTERRUPTION_MS && sameSpot && continuous) { current.clusters.push(stop); current.last = stop; current.interruptions++; continue; }
    }
    visits.push({ clusters: [stop], first: stop, last: stop, interruptions: 0 });
  }
  return visits;
}

const qualityOf = (v: Visit): StopCluster["sourceQuality"] => { const q = new Set(v.clusters.map(c => c.sourceQuality)); return q.size === 1 ? [...q][0] : q.has("unverified") || q.has("mixed") ? (q.has("verified_gps") ? "mixed" : "unverified") : "verified_gps"; };

function rank(visit: Visit, point: RolePoint, zoneM: number, schedule: { instant: number; applies: boolean }): RecognisedVisit | null {
  const centroid = { latitude: visit.clusters.reduce((n, c) => n + c.centroid.latitude * c.observations, 0) / visit.clusters.reduce((n, c) => n + c.observations, 0), longitude: visit.clusters.reduce((n, c) => n + c.centroid.longitude * c.observations, 0) / visit.clusters.reduce((n, c) => n + c.observations, 0) };
  const d = Math.round(metersBetween(centroid, point.point!));
  if (d > zoneM) return null;
  const direct = d <= point.radiusM;
  const reasons: VisitReason[] = [direct ? "direct_boundary_stop" : "found_in_search_zone_only"];
  const quality = qualityOf(visit);
  const dwellMin = visit.clusters.reduce((n, c) => n + c.dwellMs.min, 0);
  const dwellMax = visit.first.beforeAt && visit.last.afterAt ? ms(visit.last.afterAt) - ms(visit.first.beforeAt) : null;
  const edge = visit.first.beforeAt === null || visit.last.afterAt === null;
  const gap = (visit.first.beforeAt !== null && visit.first.gapBefore) || (visit.last.afterAt !== null && visit.last.gapAfter);
  const tight = visit.first.arrivalWindow.earliest !== null && visit.last.departureWindow.latest !== null && ms(visit.first.arrivalWindow.latest) - ms(visit.first.arrivalWindow.earliest) <= 6 * 60_000 && ms(visit.last.departureWindow.latest) - ms(visit.last.departureWindow.earliest) <= 6 * 60_000;
  let w = direct ? 30 : Math.round(20 * (1 - d / zoneM));
  const stay = minutes(dwellMin);
  if (stay >= 20) { w += 25; reasons.push("long_stay"); } else if (stay >= 10) { w += 18; reasons.push("moderate_stay"); } else if (stay >= 5) { w += 10; reasons.push("moderate_stay"); } else { w += 4; reasons.push("short_stay"); }
  if (quality === "verified_gps") { w += 15; reasons.push("verified_gps_positions"); } else if (quality === "mixed") { w += 8; reasons.push("mixed_positions"); } else { w += 3; reasons.push("provider_reported_unverified_positions"); }
  if (tight) { w += 5; reasons.push("windows_tight"); }
  if (!edge && !gap) w += 5;
  if (edge) { w -= 8; reasons.push("touches_edge_of_day_data", "arrival_or_departure_unknown"); }
  if (gap) { w -= 8; reasons.push("next_to_tracking_gap"); }
  if (visit.interruptions > 0) reasons.push("merged_adjacent_stops");
  if (schedule.applies) {
    if (Number.isFinite(schedule.instant)) { const arr = ms(visit.first.arrivalWindow.latest) - schedule.instant; if (arr >= -SCHEDULE_EARLY_MS && arr <= SCHEDULE_LATE_MS) { w += 10; reasons.push("fits_scheduled_time"); } else { w -= 5; reasons.push("outside_scheduled_time"); } } else reasons.push("no_scheduled_time");
  }
  if (!point.verified) { reasons.push("unreviewed_booking_point"); if (!direct) { w -= 5; reasons.push("may_belong_to_neighbouring_site"); } }
  w = Math.max(0, Math.min(100, w));
  // Confidence: high needs verified GPS, inside the direct boundary, a real stay, and closed windows. Unverified positions or a search-zone-only find are capped.
  let confidence: VisitConfidence = w >= 70 ? "high" : w >= 50 ? "medium" : "low";
  if (confidence === "high" && (quality !== "verified_gps" || !direct || stay < 10 || edge || gap)) { confidence = "medium"; reasons.push(quality !== "verified_gps" ? "confidence_capped_unverified" : "confidence_capped_search_zone"); }
  if (quality === "unverified" && confidence === "medium" && !direct) { confidence = "low"; reasons.push("confidence_capped_unverified"); }
  const alternatives: VisitAlternative[] = ["loading_or_unloading_not_proven"];
  if (stay >= 20) alternatives.push("queueing_or_waiting_outside_gate");
  if (stay >= 30 && !direct) alternatives.push("rest_or_break");
  if (!direct) alternatives.push("neighbouring_site");
  if (stay >= 8 && stay < 20) alternatives.push("fuel_or_service_stop");
  return { key: `${visit.first.firstAt}|${visit.last.lastAt}`, centroid, distanceFromPointM: d, zone: direct ? "direct" : "search", stops: visit.clusters.length, arrival: { earliest: visit.first.arrivalWindow.earliest, latest: visit.first.arrivalWindow.latest },
    departure: { earliest: visit.last.departureWindow.earliest, latest: visit.last.departureWindow.latest }, dwell: { minMinutes: stay, maxMinutes: dwellMax === null ? null : minutes(dwellMax), interruptions: visit.interruptions },
    sourceQuality: quality, edgeOfDay: edge, gap, tightWindows: tight, weight: w, confidence, reasons: [...new Set(reasons)], alternatives };
}

/** Analysis-only overrides for calibration studies. Production callers pass nothing, so the documented defaults apply. */
export type RecognitionOptions = { searchZoneUnverifiedM?: number; minVisitMinutes?: number };

function recogniseRole(input: { visits: Visit[]; observations: readonly StopObservation[]; role: RolePoint; schedule: { instant: number; applies: boolean }; afterIso?: string | null; options?: RecognitionOptions }): RoleRecognition {
  const { role } = input;
  const empty = (summary: VisitSummaryClass, note: string, zone = 0): RoleRecognition => ({ summary, searchZoneM: zone, candidates: [], driveBys: [], otherLongStops: [], note });
  if (!role.point) return empty("no_reliable_evidence", "No usable location for this role.");
  if (!input.observations.length) return empty("no_reliable_evidence", "No positions were read for this vehicle-day.");
  const zone = Math.min(role.verified ? Math.max(role.radiusM, DIRECT_RADIUS_M) : input.options?.searchZoneUnverifiedM ?? SEARCH_ZONE_UNVERIFIED_M, SEARCH_ZONE_MAX_M);
  const minStay = input.options?.minVisitMinutes ?? 0;
  let candidates = input.visits.map(v => rank(v, role, zone, input.schedule)).filter((c): c is RecognisedVisit => c !== null && c.dwell.minMinutes >= minStay);
  if (input.afterIso) { const after = ms(input.afterIso); candidates = candidates.map(c => ms(c.arrival.latest) >= after ? { ...c, reasons: [...c.reasons, "follows_pickup" as VisitReason] } : { ...c, weight: Math.max(0, c.weight - 15), reasons: [...c.reasons, "before_pickup" as VisitReason] }); }
  candidates.sort((a, b) => b.weight - a.weight || ms(a.arrival.latest) - ms(b.arrival.latest));
  for (const c of candidates.slice(1)) if (candidates[0].weight - c.weight <= COMPETITOR_MARGIN) { c.reasons.push("competing_candidate"); if (!candidates[0].reasons.includes("competing_candidate")) candidates[0].reasons.push("competing_candidate"); }
  const driveBys = findDriveBys(input.observations, role.point, Math.max(role.radiusM, DIRECT_RADIUS_M));
  const zoneM = zone;
  const otherLong = input.visits.map(v => ({ v, d: Math.round(metersBetween(v.first.centroid, role.point!)) })).filter(x => x.d > zoneM && x.d <= 10_000 && x.v.clusters.reduce((n, c) => n + c.dwellMs.min, 0) >= 30 * 60_000 && (!input.afterIso || ms(x.v.first.firstAt) >= ms(input.afterIso)))
    .slice(0, 3).map(x => ({ centroid: x.v.first.centroid, firstAt: x.v.first.firstAt, lastAt: x.v.last.lastAt, dwellMinutes: minutes(x.v.clusters.reduce((n, c) => n + c.dwellMs.min, 0)), distanceFromPointM: x.d, sourceQuality: qualityOf(x.v) }));
  let summary: VisitSummaryClass;
  if (candidates.length === 0) summary = driveBys.length ? "drive_by_rejected" : "no_reliable_evidence";
  else if (candidates.length > 1 && candidates[0].weight - candidates[1].weight <= COMPETITOR_MARGIN && candidates[0].key !== candidates[1].key) summary = "competing_candidates";
  else summary = candidates[0].weight >= MIN_PROBABLE_WEIGHT && candidates[0].confidence !== "low" && candidates[0].sourceQuality !== "unverified" ? "probable_visit" : "possible_visit";
  const note = !role.verified ? "The point is an unreviewed booking coordinate; candidates are stops near it, not confirmed arrivals." : "The point is verified by the office.";
  return { summary, searchZoneM: zone, candidates: candidates.slice(0, 5), driveBys, otherLongStops: otherLong, note };
}

/**
 * Recognises likely pickup and delivery visits for one job. `observations` is the whole vehicle-day (verified and unverified, flagged).
 * The delivery is searched only for visits that follow the best pickup candidate when one exists.
 */
export function recogniseJobVisits(input: { observations: readonly StopObservation[]; pickup: RolePoint; delivery: RolePoint; scheduledPickupMs?: number | null; options?: RecognitionOptions }): JobRecognition {
  const obs = normaliseObservations(input.observations);
  const clusters = detectStopClusters(obs);
  const visits = mergeStopsIntoVisits(clusters, obs);
  const instant = input.scheduledPickupMs ?? Number.NaN;
  const pickup = recogniseRole({ visits, observations: obs, role: input.pickup, schedule: { instant, applies: true }, options: input.options });
  const best = pickup.candidates[0] && pickup.summary !== "drive_by_rejected" ? pickup.candidates[0] : null;
  const delivery = recogniseRole({ visits, observations: obs, role: input.delivery, schedule: { instant: Number.NaN, applies: false }, afterIso: best ? best.arrival.latest : null, options: input.options });
  const hasP = pickup.candidates.length > 0, hasD = delivery.candidates.length > 0;
  const topD = delivery.candidates[0];
  const sequence: JobRecognition["sequence"] = hasP && hasD ? (topD.reasons.includes("before_pickup") ? "order_conflict" : "pickup_then_delivery_plausible") : hasP ? "pickup_only" : hasD ? "delivery_only" : "neither";
  return { version: "v5.4", pickup, delivery, sequence, algorithmic: true };
}

/**
 * Cross-job conflicts for one vehicle-day: when two jobs rank the very same visit first for the same role, neither is told it owns it.
 * Both are marked as shared and downgraded to "competing candidates" so a person decides. Different visits are left alone.
 */
export function resolveCrossJobConflicts<T extends { id: string; recognition: JobRecognition | null }>(jobs: readonly T[]): T[] {
  for (const role of ["pickup", "delivery"] as const) {
    const byKey = new Map<string, T[]>();
    for (const job of jobs) { const top = job.recognition?.[role].candidates[0]; if (top) byKey.set(top.key, [...(byKey.get(top.key) ?? []), job]); }
    for (const group of byKey.values()) {
      if (group.length < 2) continue;
      for (const job of group) {
        const r = job.recognition![role];
        r.candidates[0].reasons = [...new Set([...r.candidates[0].reasons, "shared_with_another_job" as VisitReason])];
        if (r.summary === "probable_visit" || r.summary === "possible_visit") r.summary = "competing_candidates";
        r.note += ` The same visit is the best match for ${group.length} jobs on this day, so it is not assigned to any of them.`;
      }
    }
  }
  return [...jobs];
}
