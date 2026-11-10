/**
 * V5 job movement timeline. Pure and read-only. Answers, per booked job: when did the vehicle reach and leave the
 * booked pickup and delivery locations, and how much do we trust each time?
 *
 * Rules that cannot be bent:
 *  - An arrival or departure is only ever DERIVED from observed positions near the booked location. Nothing is
 *    invented, interpolated or defaulted. No observation means the event is "missing".
 *  - Arrival is the first observation inside the radius (at or before the true arrival); departure is the last
 *    observation inside (at or after the true departure is the next observation). Both carry the window the truth
 *    lies in. A window wider than one normal reporting interval downgrades the event from verified to estimated.
 *  - Verified GPS positions give "verified_gps". Positions that are only provider-reported (no GPS fix) give
 *    "provider_reported_unverified" at low confidence. Office-confirmed events are accepted as input only; none is
 *    stored today, so the server never supplies any.
 *  - Ambiguity (several visits, overlapping locations, wrong order) yields "missing" with a reason, never a guess.
 *  - No coordinates are returned: only times, statuses, reasons and distances.
 */

export const JOB_LOCATION_RADIUS_M = 150;
/** One normal reporting interval (matches the journey ledger). A wider uncertainty window is an estimate. */
export const MOVEMENT_CADENCE_MS = 5 * 60_000;
/** Observations inside the radius this far apart belong to separate visits. */
const VISIT_SPLIT_GAP_MS = 20 * 60_000;
const AMBIGUOUS_SCHEDULE_MARGIN_MS = 60 * 60_000;

export type MovementPoint = { timestamp: string; latitude: number; longitude: number; speedKph?: number | null };
/** A pass within the radius that looks like driving by: at most two positions, under 3 minutes, moving at or above this speed.
 *  5 km/h is the "moving" threshold the journey intelligence already uses; real WO 5838 data showed a single 11 km/h position is a roll-past, not a stop. */
export const PASS_THROUGH_SPEED_KPH = 5;
const PASS_THROUGH_MAX_MS = 3 * 60_000;
export type MovementEventStatus = "verified_gps" | "provider_reported_unverified" | "office_confirmed" | "estimated" | "missing";
export type MovementConfidence = "high" | "medium" | "low" | "none";
export type MovementStage = "pickup_arrival" | "pickup_departure" | "delivery_arrival" | "delivery_departure";
export type MovementSource = "forth_verified_gps" | "forth_reported_position" | "office_decision" | "none";
export type MovementReason =
  | "no_booked_coordinates" | "no_position_evidence" | "never_within_radius" | "no_observation_before_arrival" | "window_wider_than_reporting_interval"
  | "no_observation_after_departure" | "still_at_location_at_end_of_evidence" | "multiple_visits_need_office_selection" | "pickup_and_delivery_locations_overlap"
  | "pickup_not_found" | "passed_without_stopping" | "later_visits_at_location" | "delivery_before_pickup" | "used_unverified_positions" | "scheduled_time_unavailable" | "pickup_event_missing_so_order_unchecked";

export type MovementEvent = {
  stage: MovementStage;
  status: MovementEventStatus;
  /** The observed instant (first position inside for arrivals, last position inside for departures), never an invented one. */
  at: string | null;
  /** The interval the true event lies in. `from` or `to` is null when there is no observation on that side. */
  window: { from: string | null; to: string | null } | null;
  confidence: MovementConfidence;
  source: MovementSource;
  reasons: MovementReason[];
};

export type MovementJobInput = {
  jobId: string;
  pickupTime: string | null;
  scheduledPickup: { latitude: number; longitude: number } | null;
  scheduledDelivery: { latitude: number; longitude: number } | null;
};
export type OfficeMovementEvent = { stage: MovementStage; at: string };

export type JobMovement = {
  version: "v5.0";
  jobId: string;
  radiusMeters: number;
  events: MovementEvent[];
  dwell: { pickupMinutes: number | null; deliveryMinutes: number | null; basis: "observed_first_to_last_inside" };
  closestApproachMeters: { pickup: number | null; delivery: number | null };
  /** Every visit within the radius (times and counts only), so the office can pick the right one when the system cannot. */
  visits: { pickup: VisitSummary[]; delivery: VisitSummary[] };
  positionTier: "verified_gps" | "reported_unverified" | "none";
  issues: MovementReason[];
};

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : Number.NaN);
const isValid = (p: { latitude: number; longitude: number } | null | undefined): p is { latitude: number; longitude: number } =>
  Boolean(p) && Number.isFinite(p!.latitude) && Number.isFinite(p!.longitude) && Math.abs(p!.latitude) <= 90 && Math.abs(p!.longitude) <= 180;

export function metersBetween(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const rad = (d: number) => d * Math.PI / 180;
  const dLat = rad(b.latitude - a.latitude), dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

type Visit = { firstInside: number; lastInside: number; before: number | null; after: number | null; observations: number; maxSpeedKph: number | null; passThrough: boolean };
type Tracker = { first: number; last: number; firstIndex: number; lastIndex: number; count: number; maxSpeed: number | null };

/** Splits time-ordered positions into visits to one location. Positions with a bad time or coordinates are ignored. */
export function findVisits(points: readonly MovementPoint[], target: { latitude: number; longitude: number }, radiusM: number): { visits: Visit[]; closest: number | null } {
  const ordered = points.filter(p => Number.isFinite(ms(p.timestamp)) && isValid(p)).map(p => { const d = metersBetween(p, target); return { t: ms(p.timestamp), inside: d <= radiusM, d, speed: typeof p.speedKph === "number" && Number.isFinite(p.speedKph) ? p.speedKph : null }; }).sort((a, b) => a.t - b.t);
  const closest = ordered.length ? Math.round(Math.min(...ordered.map(p => p.d))) : null;
  const visits: Visit[] = [];
  let current: Tracker | null = null;
  ordered.forEach((p, index) => {
    if (!p.inside) return;
    if (current && p.t - current.last > VISIT_SPLIT_GAP_MS) { visits.push(close(current, ordered)); current = null; }
    if (!current) current = { first: p.t, last: p.t, firstIndex: index, lastIndex: index, count: 1, maxSpeed: p.speed };
    else { current.last = p.t; current.lastIndex = index; current.count++; if (p.speed !== null) current.maxSpeed = current.maxSpeed === null ? p.speed : Math.max(current.maxSpeed, p.speed); }
  });
  if (current) visits.push(close(current, ordered));
  return { visits, closest };
}
function close(c: Tracker, ordered: { t: number; inside: boolean }[]): Visit {
  let before: number | null = null, after: number | null = null;
  for (let i = c.firstIndex - 1; i >= 0; i--) if (!ordered[i].inside) { before = ordered[i].t; break; }
  for (let i = c.lastIndex + 1; i < ordered.length; i++) if (!ordered[i].inside) { after = ordered[i].t; break; }
  // A drive-by is brief, sparse and fast. Without any speed reading a short visit stays a visit (it is not proven to be a drive-by).
  const passThrough = c.count <= 2 && c.last - c.first < PASS_THROUGH_MAX_MS && c.maxSpeed !== null && c.maxSpeed >= PASS_THROUGH_SPEED_KPH;
  return { firstInside: c.first, lastInside: c.last, before, after, observations: c.count, maxSpeedKph: c.maxSpeed, passThrough };
}

export type VisitSummary = { from: string; to: string; observations: number; maxSpeedKph: number | null; kind: "stopped_or_slow" | "drive_by" };
const summarize = (visits: Visit[]): VisitSummary[] => visits.slice(0, 12).map(v => ({ from: new Date(v.firstInside).toISOString(), to: new Date(v.lastInside).toISOString(), observations: v.observations, maxSpeedKph: v.maxSpeedKph === null ? null : Math.round(v.maxSpeedKph), kind: v.passThrough ? "drive_by" as const : "stopped_or_slow" as const }));

const iso = (t: number | null) => (t === null ? null : new Date(t).toISOString());
const missing = (stage: MovementStage, reasons: MovementReason[]): MovementEvent => ({ stage, status: "missing", at: null, window: null, confidence: "none", source: "none", reasons });

function arrivalEvent(stage: MovementStage, v: Visit, tier: "verified" | "reported"): MovementEvent {
  const reasons: MovementReason[] = [];
  const width = v.before === null ? null : v.firstInside - v.before;
  if (v.before === null) reasons.push("no_observation_before_arrival");
  else if (width! > MOVEMENT_CADENCE_MS) reasons.push("window_wider_than_reporting_interval");
  const tight = width !== null && width <= MOVEMENT_CADENCE_MS;
  if (tier === "reported") reasons.push("used_unverified_positions");
  const status: MovementEventStatus = tier === "reported" ? "provider_reported_unverified" : tight ? "verified_gps" : "estimated";
  return { stage, status, at: iso(v.firstInside), window: { from: iso(v.before), to: iso(v.firstInside) }, confidence: tier === "reported" ? "low" : tight ? "high" : "medium", source: tier === "reported" ? "forth_reported_position" : "forth_verified_gps", reasons };
}
function departureEvent(stage: MovementStage, v: Visit, tier: "verified" | "reported"): MovementEvent {
  if (v.after === null) return { ...missing(stage, ["no_observation_after_departure", "still_at_location_at_end_of_evidence"]), window: { from: iso(v.lastInside), to: null } };
  const reasons: MovementReason[] = [];
  const width = v.after - v.lastInside;
  const tight = width <= MOVEMENT_CADENCE_MS;
  if (!tight) reasons.push("window_wider_than_reporting_interval");
  if (tier === "reported") reasons.push("used_unverified_positions");
  const status: MovementEventStatus = tier === "reported" ? "provider_reported_unverified" : tight ? "verified_gps" : "estimated";
  return { stage, status, at: iso(v.lastInside), window: { from: iso(v.lastInside), to: iso(v.after) }, confidence: tier === "reported" ? "low" : tight ? "high" : "medium", source: tier === "reported" ? "forth_reported_position" : "forth_verified_gps", reasons };
}

/** Picks one visit, or says why it cannot. Prefers the visit nearest the scheduled instant; two near-equal candidates are ambiguous. */
function chooseVisit(visits: Visit[], scheduledMs: number, notBefore: number | null): { visit: Visit | null; reason: MovementReason | null } {
  const eligible = notBefore === null ? visits : visits.filter(v => v.lastInside >= notBefore);
  if (eligible.length === 0) return { visit: null, reason: null };
  if (eligible.length === 1) return { visit: eligible[0], reason: null };
  if (!Number.isFinite(scheduledMs)) return { visit: null, reason: "multiple_visits_need_office_selection" };
  const ranked = [...eligible].sort((a, b) => Math.abs(a.firstInside - scheduledMs) - Math.abs(b.firstInside - scheduledMs));
  const gap = Math.abs(ranked[1].firstInside - scheduledMs) - Math.abs(ranked[0].firstInside - scheduledMs);
  return gap < AMBIGUOUS_SCHEDULE_MARGIN_MS ? { visit: null, reason: "multiple_visits_need_office_selection" } : { visit: ranked[0], reason: null };
}

function minutesBetween(a: MovementEvent, b: MovementEvent): number | null {
  if (a.at === null || b.at === null) return null;
  if (a.status === "missing" || b.status === "missing") return null;
  const m = (ms(b.at) - ms(a.at)) / 60_000;
  return m >= 0 ? Math.round(m) : null;
}

/**
 * @param day Bangkok day (YYYY-MM-DD), used to read the scheduled pickup time.
 * @param verified verified-GPS positions in accepted intervals (server side only).
 * @param reported positions that carry no verified GPS fix (server side only); used only when verified positions never reach the location.
 */
export function deriveJobMovement(input: { day: string; job: MovementJobInput; verified: readonly MovementPoint[]; reported: readonly MovementPoint[]; office?: readonly OfficeMovementEvent[]; radiusMeters?: number }): JobMovement {
  const radius = input.radiusMeters ?? JOB_LOCATION_RADIUS_M;
  const { job } = input;
  const pickup = isValid(job.scheduledPickup) ? job.scheduledPickup : null, delivery = isValid(job.scheduledDelivery) ? job.scheduledDelivery : null;
  const scheduledMs = job.pickupTime && /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(job.pickupTime) ? Date.parse(`${input.day}T${job.pickupTime.length === 5 ? `${job.pickupTime}:00` : job.pickupTime}+07:00`) : Number.NaN;
  const issues: MovementReason[] = [];
  if (!Number.isFinite(scheduledMs)) issues.push("scheduled_time_unavailable");
  const hasEvidence = input.verified.length > 0 || input.reported.length > 0;
  const overlap = pickup && delivery ? metersBetween(pickup, delivery) <= radius * 2 : false;
  if (overlap) issues.push("pickup_and_delivery_locations_overlap");

  type Located = { tier: "verified" | "reported" | "none"; visits: Visit[]; passes: Visit[]; all: Visit[]; closest: number | null };
  const split = (tier: Located["tier"], all: Visit[], closest: number | null): Located => ({ tier, visits: all.filter(v => !v.passThrough), passes: all.filter(v => v.passThrough), all, closest });
  const locate = (target: { latitude: number; longitude: number } | null): Located => {
    if (!target) return split("none", [], null);
    const v = findVisits(input.verified, target, radius);
    if (v.visits.length) return split("verified", v.visits, v.closest);
    const r = findVisits(input.reported, target, radius);
    if (r.visits.length) return split("reported", r.visits, r.closest);
    return split("none", [], v.closest ?? r.closest);
  };
  /** A location the vehicle only drove past inside the radius is not an arrival: say so, with the time it passed. */
  const passedBy = (stageA: MovementStage, stageB: MovementStage, found: Located): MovementEvent[] => {
    const w = { from: new Date(found.passes[0].firstInside).toISOString(), to: new Date(found.passes[0].lastInside).toISOString() };
    return [{ ...missing(stageA, ["passed_without_stopping"]), window: w }, { ...missing(stageB, ["passed_without_stopping"]), window: w }];
  };
  const base = (target: unknown): MovementReason[] => (!target ? ["no_booked_coordinates"] : !hasEvidence ? ["no_position_evidence"] : ["never_within_radius"]);

  const events: MovementEvent[] = [];
  const pickupSearch = locate(pickup);
  let pickupVisit: Visit | null = null, pickupTier: "verified" | "reported" | null = null;
  if (pickupSearch.visits.length) {
    const chosen = chooseVisit(pickupSearch.visits, scheduledMs, null);
    if (chosen.visit) { pickupVisit = chosen.visit; pickupTier = pickupSearch.tier === "none" ? null : pickupSearch.tier; }
    else events.push(missing("pickup_arrival", [chosen.reason!]), missing("pickup_departure", [chosen.reason!]));
  } else if (pickupSearch.passes.length) events.push(...passedBy("pickup_arrival", "pickup_departure", pickupSearch));
  else events.push(missing("pickup_arrival", base(pickup)), missing("pickup_departure", base(pickup)));
  if (pickupVisit && pickupTier) events.push(arrivalEvent("pickup_arrival", pickupVisit, pickupTier), departureEvent("pickup_departure", pickupVisit, pickupTier));

  const deliverySearch: Located = overlap ? split("none", [], null) : locate(delivery);
  const pickupArrival = events.find(e => e.stage === "pickup_arrival");
  const pickupFound = Boolean(pickupArrival && pickupArrival.status !== "missing");
  if (overlap) events.push(missing("delivery_arrival", ["pickup_and_delivery_locations_overlap"]), missing("delivery_departure", ["pickup_and_delivery_locations_overlap"]));
  else if (deliverySearch.visits.length) {
    const notBefore = pickupVisit ? pickupVisit.firstInside : null;
    const afterPickup = notBefore === null ? deliverySearch.visits : deliverySearch.visits.filter(v => v.firstInside > notBefore);
    if (afterPickup.length === 0) events.push(missing("delivery_arrival", ["delivery_before_pickup"]), missing("delivery_departure", ["delivery_before_pickup"]));
    else {
      // With a found pickup, the first delivery-location visit after it is the natural delivery (vehicles go pickup -> delivery); later visits
      // may be other jobs, so the result is flagged and capped at medium confidence rather than treated as certain. Without a pickup anchor,
      // several visits cannot be ordered and stay ambiguous.
      const anchored = pickupFound && afterPickup.length > 1;
      const chosen = anchored ? { visit: afterPickup[0], reason: null } : chooseVisit(afterPickup, Number.NaN, null);
      if (!chosen.visit) events.push(missing("delivery_arrival", [chosen.reason!]), missing("delivery_departure", [chosen.reason!]));
      else {
        const tier = deliverySearch.tier === "none" ? "verified" : deliverySearch.tier;
        const a = arrivalEvent("delivery_arrival", chosen.visit, tier), d = departureEvent("delivery_departure", chosen.visit, tier);
        if (!pickupFound) { a.reasons.push("pickup_event_missing_so_order_unchecked"); d.reasons.push("pickup_event_missing_so_order_unchecked"); }
        if (anchored) for (const e of [a, d]) { e.reasons.push("later_visits_at_location"); if (e.confidence === "high") e.confidence = "medium"; }
        events.push(a, d);
      }
    }
  } else if (deliverySearch.passes.length) events.push(...passedBy("delivery_arrival", "delivery_departure", deliverySearch));
  else events.push(missing("delivery_arrival", base(delivery)), missing("delivery_departure", base(delivery)));

  // Office-confirmed events override observed ones for that stage only and are labelled as such. None is supplied by the server today.
  for (const o of input.office ?? []) {
    const index = events.findIndex(e => e.stage === o.stage);
    if (index >= 0 && Number.isFinite(ms(o.at))) events[index] = { stage: o.stage, status: "office_confirmed", at: new Date(ms(o.at)).toISOString(), window: null, confidence: "high", source: "office_decision", reasons: [] };
  }
  const order: MovementStage[] = ["pickup_arrival", "pickup_departure", "delivery_arrival", "delivery_departure"];
  events.sort((a, b) => order.indexOf(a.stage) - order.indexOf(b.stage));
  const get = (s: MovementStage) => events.find(e => e.stage === s)!;
  const usedVerified = events.some(e => e.source === "forth_verified_gps"), usedReported = events.some(e => e.source === "forth_reported_position");
  return {
    version: "v5.0", jobId: job.jobId, radiusMeters: radius, events,
    dwell: { pickupMinutes: minutesBetween(get("pickup_arrival"), get("pickup_departure")), deliveryMinutes: minutesBetween(get("delivery_arrival"), get("delivery_departure")), basis: "observed_first_to_last_inside" },
    closestApproachMeters: { pickup: pickupSearch.closest, delivery: overlap ? null : deliverySearch.closest },
    visits: { pickup: summarize(pickupSearch.all), delivery: summarize(deliverySearch.all) },
    positionTier: usedVerified ? "verified_gps" : usedReported ? "reported_unverified" : "none",
    issues
  };
}

export type MovementAccess<S = unknown, V = unknown> = { movement: JobMovement | null; stopAnalysis: S | null; visitRecognition: V | null; movementAccess: "granted" | "requires_authorisation" | "not_read" };
/** Journey-level detail (times, stop clusters and any candidate coordinates) comes from historical positions, so it follows the same server-side gate as journeys. */
export function applyMovementAccess<S, V, T extends { movement?: JobMovement | null; stopAnalysis?: S | null; visitRecognition?: V | null }>(job: T, allowed: boolean): Omit<T, "movement" | "stopAnalysis" | "visitRecognition"> & MovementAccess<S, V> {
  const { movement, stopAnalysis, visitRecognition, ...rest } = job;
  return { ...rest, movement: allowed ? movement ?? null : null, stopAnalysis: allowed ? stopAnalysis ?? null : null, visitRecognition: allowed ? visitRecognition ?? null : null, movementAccess: !allowed ? "requires_authorisation" : movement ? "granted" : "not_read" };
}
