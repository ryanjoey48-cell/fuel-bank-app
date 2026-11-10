import { bangkokDay, calculateVehicleDay, segmentTimeline } from "./fleet-intelligence";
import { normalizeHistoricalLog } from "./forth-history-log";
import { reconcileProviderSegments, sourceAwareDay, type SourceMetric } from "./fleet-intelligence-sources";
import { distanceKm } from "./fleet-intelligence";
import { createHash } from "node:crypto";
import type { BookingSnapshot } from "./fleet-intelligence-ees-source";
import { buildJourneyLedger } from "./fleet-journey-ledger";
import { deriveJobMovement, JOB_LOCATION_RADIUS_M, type MovementPoint } from "./fleet-job-movement";
import { resolveJobPoint, type SitePin } from "./fleet-location-priority";
import { assessSiteVisit, searchCandidateStops, type StopObservation } from "./fleet-stop-intelligence";
import { recogniseJobVisits, resolveCrossJobConflicts, type JobRecognition } from "./fleet-visit-recognition";

const registrationKey = (s: string) => s.normalize("NFKC").replace(/[\s\-‐‑‒–—]/g, "").toUpperCase();
export function buildProviderDay(input: { vehicleId: string; registration: string; deviceId: string; day: string; capturedAt: string; reportRows: Record<string, unknown>[] | null; logRows: Record<string, unknown>[] | null }) {
  // A current mapping is not effective-dated historical proof. Preserve that uncertainty.
  const scopeMatches = (row: Record<string, unknown>) => String(row.gpsID) === input.deviceId && registrationKey(String(row.plateNumber ?? "")) === registrationKey(input.registration);
  if (input.logRows?.some(row => !scopeMatches(row))) throw new Error("historical_identity_conflict");
  if (input.reportRows?.some(row => String(row.boxId) === input.deviceId && registrationKey(String(row.plateNo ?? "")) !== registrationKey(input.registration))) throw new Error("report_registration_conflict");
  const replay = normalizeHistoricalLog(input.logRows ?? [], input.deviceId, "Asia/Bangkok");
  if (!replay) throw new Error("invalid_historical_log");
  const points = replay.points.map(point => ({ ...point, evidenceId: createHash("sha256").update(JSON.stringify([input.deviceId, point])).digest("hex") }));
  const bounds = bangkokDay(input.day);
  if (points.some(point => point.timestampIso && (Date.parse(point.timestampIso) < bounds.start || Date.parse(point.timestampIso) >= bounds.end))) throw new Error("historical_period_conflict");
  const orderedPoints = [...points].sort((a,b) => (a.timestampIso ?? "~").localeCompare(b.timestampIso ?? "~"));
  const daily = calculateVehicleDay(input.day, points);
  const provider = reconcileProviderSegments({ rows: input.reportRows ?? [], deviceId: input.deviceId, day: input.day, completeness: "unknown", capturedAt: input.capturedAt });
  const sources = sourceAwareDay({ day: input.day, gpsKm: daily.observedKm, gpsComplete: daily.complete, gpsEvidenceIds: daily.intervals.filter(i => i.km !== null).flatMap(i => i.evidenceIds), gpsSourceTimestamp: orderedPoints.filter(p => p.timestampIso).at(-1)?.timestampIso ?? null, provider });
  if (provider.arithmetic.status !== "pass") sources.providerReported = { ...sources.providerReported, value: null, status: "unknown", reasons: [...sources.providerReported.reasons, "provider_totals_not_reconciled"] };
  const providerGaps: { start: string; end: string }[] = [];
  let previousEnd: string | null = null;
  for (const row of [...provider.segments].sort((a,b) => a.start.localeCompare(b.start))) {
    if (previousEnd && row.start > previousEnd) providerGaps.push({ start: previousEnd, end: row.start });
    if (row.end && (!previousEnd || row.end > previousEnd)) previousEnd = row.end;
  }
  // V4.4: journeys from provider segments plus the log's incremental Distance. Times, counts and km only; no coordinates.
  const journeyLedger = buildJourneyLedger({ day: input.day, segments: provider.segments.map(s => ({ id: s.id, start: s.start, end: s.end, km: s.km })),
    points: input.logRows === null ? [] : replay.points, gpsIntervals: daily.intervals.map(i => ({ start: i.start, end: i.end, km: i.km })), logAvailable: input.logRows !== null });
  return {
    journeyLedger,
    vehicleId: input.vehicleId, registration: input.registration, deviceId: input.deviceId, day: input.day, capturedAt: input.capturedAt,
    source: "/trackingresource/api/vehicle/parkingTrip", mapping: "current_association_historical_period_unverified" as const,
    // routingTime is preserved as the provider's own label; it is not verified driving time.
    sources, provider: { ...provider, segments: provider.segments.map(({ raw, ...segment }) => ({ ...segment, routingTime: typeof raw.routingTime === "string" && /^\d{1,3}:[0-5]\d:[0-5]\d$/.test(raw.routingTime) ? raw.routingTime : null })) },
    providerGaps, logAvailable: input.logRows !== null, reportAvailable: input.reportRows !== null,
    gps: { observedKm: daily.observedKm, coveredSeconds: daily.coveredSeconds, unknownSeconds: daily.missingSeconds, complete: daily.complete,
      observations: points.length, verifiedObservations: points.filter(p => p.verifiedGps).length,
      timeline: segmentTimeline(daily.intervals).map(({ intervalIds: _ids, ...segment }) => segment),
      firstVerifiedAt: orderedPoints.find(p => p.verifiedGps)?.timestampIso ?? null,
      lastVerifiedAt: [...orderedPoints].reverse().find(p => p.verifiedGps)?.timestampIso ?? null },
    // Only coordinates belonging to accepted GPS intervals may support observed job matching.
    observedPoints: orderedPoints.filter(p => p.verifiedGps && daily.intervals.some(i => i.km !== null && i.evidenceIds.includes(p.evidenceId))).map(p => ({ timestamp: p.timestampIso!, latitude: p.latitude!, longitude: p.longitude!, speedKph: p.speedKph ?? null })),
    // V5: provider-reported positions without a verified GPS fix. Server-side only; used solely to label arrival/departure as "reported, unverified".
    reportedPoints: orderedPoints.filter(p => !p.verifiedGps && p.timestampIso && Number.isFinite(p.latitude) && Number.isFinite(p.longitude)).map(p => ({ timestamp: p.timestampIso!, latitude: p.latitude!, longitude: p.longitude!, speedKph: p.speedKph ?? null })),
    partialErrors: [input.reportRows === null ? "provider_report_unavailable" : null, input.logRows === null ? "gps_log_unavailable" : null].filter((v): v is string => v !== null)
  };
}
export type ProviderDay = ReturnType<typeof buildProviderDay>;

/**
 * What an API response may carry. `observedPoints` are verified-GPS coordinates used only on the server for job matching;
 * location history is released only by the gated playback route, so it is never returned with a distance report.
 */
export function publicProviderDay<T extends { observedPoints?: unknown; reportedPoints?: unknown }>(day: T): Omit<T, "observedPoints" | "reportedPoints"> {
  const { observedPoints: _locations, reportedPoints: _reported, ...rest } = day;
  return rest;
}

/** Scheduled pickup is an instant, not an invented job completion window. */
export function suggestDayJobs(vehicleId: string, registration: string, day: string, jobs: readonly BookingSnapshot[], evidence: ProviderDay | null, options: { pinsByLocation?: Readonly<Record<string, readonly SitePin[]>>; vehicleClass?: string | null } = {}) {
  const built = jobs.filter(job => job.booking_date === day && (job.vehicle_id ? job.vehicle_id === vehicleId : registrationKey(job.vehicle_registration ?? job.vehicle ?? "") === registrationKey(registration))).map(job => {
    const reasons = [job.vehicle_id === vehicleId ? "stable_vehicle_assignment" : "registration_assignment", "same_booking_date"];
    let score = job.vehicle_id === vehicleId ? 40 : 20;
    const time = typeof job.pickup_time === "string" && /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(job.pickup_time) ? Date.parse(`${day}T${job.pickup_time.length === 5 ? `${job.pickup_time}:00` : job.pickup_time}+07:00`) : NaN;
    if (Number.isFinite(time) && evidence?.gps.timeline.some(s => s.km !== null && Date.parse(s.start) <= time && time <= Date.parse(s.end))) { score += 20; reasons.push("scheduled_pickup_within_observed_interval"); }
    // Context only: a provider report segment is not verified GPS, so it adds no evidence weight.
    if (Number.isFinite(time) && evidence?.provider.arithmetic.status === "pass" && evidence.provider.segments.some(s => s.km > 0 && s.end !== null && Date.parse(s.start) <= time && time <= Date.parse(s.end))) reasons.push("scheduled_pickup_within_provider_segment");
    const valid = (lat: number | null, lng: number | null) => lat !== null && lng !== null && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
    const points = evidence?.observedPoints ?? [];
    if (valid(job.pickup_lat, job.pickup_lng) && valid(job.dropoff_lat, job.dropoff_lng)) {
      const start = points.findIndex(p => distanceKm(p, { latitude: job.pickup_lat!, longitude: job.pickup_lng! }) <= .15);
      if (start >= 0 && points.slice(start + 1).some(p => distanceKm(p, { latitude: job.dropoff_lat!, longitude: job.dropoff_lng! }) <= .15)) { score += 20; reasons.push("ordered_pickup_delivery_proximity"); }
    }
    const scheduledPickup = valid(job.pickup_lat, job.pickup_lng) ? { latitude: job.pickup_lat!, longitude: job.pickup_lng! } : null;
    const scheduledDelivery = valid(job.dropoff_lat, job.dropoff_lng) ? { latitude: job.dropoff_lat!, longitude: job.dropoff_lng! } : null;
    // V5.1: which point the timeline uses. Office-verified pins come first; the booking coordinate is the unverified fallback and is never overwritten.
    const pinsFor = (id: string | null | undefined) => (id ? options.pinsByLocation?.[id] ?? [] : []);
    const pickupPoint = resolveJobPoint({ booking: scheduledPickup, pins: pinsFor(job.pickup_location_id), vehicleClass: options.vehicleClass ?? null });
    const deliveryPoint = resolveJobPoint({ booking: scheduledDelivery, pins: pinsFor(job.dropoff_location_id), vehicleClass: options.vehicleClass ?? null });
    const reportedPoints = (evidence as { reportedPoints?: MovementPoint[] } | null)?.reportedPoints ?? [];
    // V5: arrival and departure at the used points, derived from positions on the server. Times and statuses only; the caller must gate it like journeys.
    const movement = evidence ? deriveJobMovement({ day, job: { jobId: job.id, pickupTime: job.pickup_time, scheduledPickup: pickupPoint.point, scheduledDelivery: deliveryPoint.point }, verified: evidence.observedPoints, reported: reportedPoints }) : null;
    // V5.2: what the observations support at each site (classes A to G, bounded windows) and a bounded search for stops near an unverified point.
    const observations: StopObservation[] = evidence ? [...evidence.observedPoints.map(p => ({ timestamp: p.timestamp, latitude: p.latitude, longitude: p.longitude, speedKph: p.speedKph ?? null, verified: true })), ...reportedPoints.map(p => ({ timestamp: p.timestamp, latitude: p.latitude, longitude: p.longitude, speedKph: p.speedKph ?? null, verified: false }))] : [];
    const site = (resolved: ReturnType<typeof resolveJobPoint>) => evidence ? {
      point: { provenance: resolved.provenance, rank: resolved.rank, verified: resolved.verified, ambiguous: resolved.ambiguous, radiusMeters: resolved.radiusMeters ?? JOB_LOCATION_RADIUS_M, reason: resolved.reason, point: resolved.point, bookingCoordinate: resolved.bookingCoordinate },
      assessment: assessSiteVisit({ observations, point: resolved.point, radiusM: resolved.radiusMeters ?? JOB_LOCATION_RADIUS_M, pointVerified: resolved.verified }),
      candidateSearch: resolved.point && !resolved.verified ? searchCandidateStops({ observations, point: resolved.point }) : null
    } : null;
    const stopAnalysis = evidence ? { version: "v5.2" as const, pickup: site(pickupPoint), delivery: site(deliveryPoint) } : null;
    // V5.4: ranked likely visits for each role, with bounded windows and honest confidence. Algorithmic only; never a confirmation.
    const visitRecognition: JobRecognition | null = evidence ? recogniseJobVisits({ observations, pickup: { point: pickupPoint.point, verified: pickupPoint.verified, radiusM: pickupPoint.radiusMeters ?? JOB_LOCATION_RADIUS_M }, delivery: { point: deliveryPoint.point, verified: deliveryPoint.verified, radiusM: deliveryPoint.radiusMeters ?? JOB_LOCATION_RADIUS_M }, scheduledPickupMs: Number.isFinite(time) ? time : null }) : null;
    // V5.5: the booking names a second, registration-like vehicle in its `vehicle` text. Real days showed these jobs belong to another vehicle
    // (the named registration barely moved). Suspected data-entry conflict: surfaced for review, never used to move the job.
    const textKey = job.vehicle ? registrationKey(job.vehicle) : "";
    const bookingVehicleConflict = job.vehicle && job.vehicle_registration && textKey !== registrationKey(job.vehicle_registration) && (job.vehicle.match(/[0-9]/g) ?? []).length >= 3 ? job.vehicle : null;
    return { jobId: job.id, bookingVehicleConflict, workOrder: job.job_order_number, bookingRef: job.booking_id ?? null, pickupName: job.pickup ?? null, deliveryName: job.dropoff ?? null, driverId: job.driver_id ?? null, driverText: job.driver ?? null, pickupTime: job.pickup_time, bookingAssignment: job.vehicle_id === vehicleId ? "stable_vehicle_id" : "registration_only", score, reasons,
      scheduledPickup, scheduledDelivery, bookingUpdatedAt: job.updated_at ?? null, movement, stopAnalysis, visitRecognition,
      status: "confirmation_required" as const, allocatedKm: null, observedDeliveryTime: null };
  });
  // Two jobs whose best visit is the very same stop are both told it is shared, so no stop is silently assigned to one job.
  resolveCrossJobConflicts(built.map(job => ({ id: job.jobId, recognition: job.visitRecognition })));
  // Identical route booked more than once for the same vehicle and day: flag as a possible duplicate entry (nothing is merged or removed).
  // V6: same route, day and vehicle is only a POSSIBLE double entry when the driver, vehicle text and pickup time are also identical; otherwise it is usually a separate truck carrying a copied registration.
  const source = new Map(jobs.map(row => [row.id, row]));
  const text = (value: string | null | undefined) => (value ?? "").normalize("NFKC").trim().replace(/s+/g, " ").toLowerCase();
  const routeKey = (job: (typeof built)[number]) => `${text(job.pickupName)}>${text(job.deliveryName)}`;
  const signature = (job: (typeof built)[number]) => `${routeKey(job)}|${text(source.get(job.jobId)?.driver)}|${text(source.get(job.jobId)?.vehicle)}|${(job.pickupTime ?? "").slice(0, 5)}`;
  const withDuplicateFlag = built.map(job => ({ ...job,
    possibleDuplicateBooking: job.pickupName !== null && built.filter(other => other.jobId !== job.jobId && signature(other) === signature(job)).length > 0,
    sameRouteOtherTruck: job.pickupName !== null && built.some(other => other.jobId !== job.jobId && routeKey(other) === routeKey(job) && signature(other) !== signature(job)) }));
  return withDuplicateFlag.sort((a,b) => b.score - a.score || a.jobId.localeCompare(b.jobId));
}

/**
 * Day-level attribution ledger. There is no approved confirmation store yet, so
 * confirmed assignments are always zero and every reconciled provider kilometre
 * remains unattributed. Suggestions never move kilometres into a job.
 */
export function dayAttribution(evidence: ProviderDay | null, jobs: ReturnType<typeof suggestDayJobs> | null) {
  const providerKm = evidence && evidence.provider.arithmetic.status === "pass" ? evidence.sources.providerReported.value : null;
  return {
    providerKm,
    confirmedAssignments: 0,
    confirmedJobKm: null,
    unconfirmedSuggestions: jobs === null ? null : jobs.length,
    unattributedProviderKm: providerKm,
    confirmationStore: "not_available" as const
  };
}

/** No partial sums presented as fleet totals, no duplicate or incompatible periods. */
export function summarizeProviderFleet(day: string, rows: readonly { vehicleId: string; metric: SourceMetric | null; arithmeticPassed: boolean }[]) {
  bangkokDay(day);
  if (new Set(rows.map(r => r.vehicleId)).size !== rows.length) throw new Error("duplicate_vehicle_day");
  const expected = `${day}T00:00:00+07:00`;
  const usable = rows.filter(r => r.metric && r.metric.value !== null && Number.isFinite(r.metric.value) && r.metric.value >= 0 && r.metric.source === "forth_parking_report" && r.metric.confidence === "provider_reported" && r.metric.unit === "km" && !["unknown", "not_applicable"].includes(r.metric.status) && r.arithmeticPassed);
  const complete = usable.filter(r => r.metric!.completeness === "complete" && ["known", "verified_zero"].includes(r.metric!.status) && Date.parse(r.metric!.period.start) === Date.parse(expected) && Date.parse(r.metric!.period.end) === Date.parse(expected) + 86400000 && r.metric!.period.timeZone === "Asia/Bangkok");
  return { vehicles: rows.length, reportedVehicles: usable.length, unknownVehicles: rows.length - usable.length, completeVehicles: complete.length,
    totalKm: rows.length > 0 && complete.length === rows.length ? complete.reduce((n,r) => n + r.metric!.value!, 0) : null };
}
