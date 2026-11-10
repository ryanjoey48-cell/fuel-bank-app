/**
 * V4.4 journey-to-job intelligence and daily kilometre accountability. Pure and read-only.
 *
 * Three distances are kept apart and never substituted for one another:
 *  - providerKm: the Forth parkingTrip report segment distance (provider-reported, not GPS-verified);
 *  - reportedTrailKm: the sum of the log's incremental Distance values (metres), from reported positions that may be "No GPS";
 *  - verifiedGpsKm: only from GPS-derived intervals that pass the verified-GPS rule.
 *
 * Journeys come from provider report segments (no boundaries are invented). Office decisions are never inputs to the
 * confirmed category: only `confirmedAllocations` from an approved, persisted source may be, and none exists today.
 * No coordinates leave this module.
 */

/** Playback gap-edge marker (matches Journey Playback). */
export const LOG_GAP_MS = 5 * 60_000;
/** Missing history: no record for more than two ~5-minute reporting intervals. A 301-second spacing is cadence jitter, not loss. */
export const MISSING_HISTORY_MS = 10 * 60_000;
const PICKUP_LEAD_MS = 60 * 60_000;
const cents = (km: number) => Math.round(km * 100);
const km2 = (c: number) => c / 100;

export type LedgerLogPoint = {
  timestampIso: string | null;
  verifiedGps: boolean;
  trailEligible: boolean;
  positionQuality: string;
  speedKph: number | null;
  engineOn: boolean | null;
  /** Forth log Distance: incremental metres from the previous record. */
  sourceDistanceRaw: number | null;
};
export type LedgerProviderSegment = { id: string; start: string; end: string | null; km: number };
export type LedgerGpsInterval = { start: string; end: string; km: number | null };

export type JourneyKind = "moving" | "stopped" | "open_final";
export type JourneyIssue = "overlaps_another_segment" | "open_segment_with_distance" | "no_log_observations" | "log_gap_inside";
export type Journey = {
  id: string;
  segmentId: string;
  kind: JourneyKind;
  start: string;
  end: string | null;
  minutes: number | null;
  providerKm: number;
  observations: number;
  movingObservations: number;
  engineOnObservations: number | null;
  reportedTrailKm: number | null;
  verifiedGpsKm: number | null;
  positionSource: "gps" | "no_gps" | "mixed" | "none";
  gapsInside: number;
  issues: JourneyIssue[];
  /** Ambiguous journeys are reported but never allocated as if fully observed. */
  ambiguous: boolean;
};
export type MissingInterval = { start: string; end: string; minutes: number; source: "log_gap" | "before_first_record" | "after_last_record" };
/** A period not covered by any provider report segment. Log distance there (if any) is reported, never allocated. */
export type OutsideReportInterval = { start: string; end: string; minutes: number; observations: number; logKm: number | null };
export type JourneyLedger = {
  version: "v4.4";
  journeys: Journey[];
  missing: MissingInterval[];
  outsideReport: OutsideReportInterval[];
  totals: {
    outsideReportMinutes: number; outsideReportLogKm: number | null; cadenceJitterGaps: number;
    providerKm: number; movingJourneys: number; stops: number; openFinal: number; ambiguousJourneys: number;
    reportedTrailKm: number | null; verifiedGpsKm: number | null; observations: number; duplicateObservations: number;
    positionSource: Journey["positionSource"]; missingMinutes: number;
  };
};

const ms = (iso: string | null) => (iso ? Date.parse(iso) : Number.NaN);

/** Remove exact duplicate observations (same timestamp and distance), keeping time order. */
export function dedupeLedgerPoints(points: readonly LedgerLogPoint[]) {
  const seen = new Set<string>(); const kept: LedgerLogPoint[] = []; let duplicates = 0;
  for (const p of [...points].sort((a, b) => (ms(a.timestampIso) || 0) - (ms(b.timestampIso) || 0))) {
    if (!p.timestampIso || !Number.isFinite(ms(p.timestampIso))) continue;
    const key = `${p.timestampIso}|${p.sourceDistanceRaw ?? ""}|${p.speedKph ?? ""}`;
    if (seen.has(key)) { duplicates++; continue; }
    seen.add(key); kept.push(p);
  }
  return { points: kept, duplicates };
}

function positionSource(points: readonly LedgerLogPoint[]): Journey["positionSource"] {
  if (!points.length) return "none";
  const verified = points.filter(p => p.verifiedGps).length;
  return verified === points.length ? "gps" : verified === 0 ? "no_gps" : "mixed";
}

/**
 * Builds journeys from provider segments and the day's log. Each log increment belongs to at most one segment
 * (start, end], so trail distance is never double-counted. Verified GPS km is only given when every GPS interval
 * touching the window lies fully inside it and is verified; otherwise it is unknown.
 */
export function buildJourneyLedger(input: { day: string; segments: readonly LedgerProviderSegment[]; points: readonly LedgerLogPoint[]; gpsIntervals: readonly LedgerGpsInterval[]; logAvailable: boolean }): JourneyLedger {
  const { points, duplicates } = dedupeLedgerPoints(input.points);
  const ordered = [...input.segments].sort((a, b) => ms(a.start) - ms(b.start) || a.id.localeCompare(b.id));
  const overlapping = new Set<string>();
  for (let i = 0; i < ordered.length; i++) for (let j = i + 1; j < ordered.length; j++) {
    const a = ordered[i], b = ordered[j]; const aEnd = a.end ? ms(a.end) : Number.POSITIVE_INFINITY; const bEnd = b.end ? ms(b.end) : Number.POSITIVE_INFINITY;
    if (ms(b.start) < aEnd && ms(a.start) < bEnd) { overlapping.add(a.id); overlapping.add(b.id); }
  }
  const claimed = new Set<number>();
  const journeys: Journey[] = ordered.map((s, index) => {
    const from = ms(s.start), to = s.end ? ms(s.end) : Number.POSITIVE_INFINITY;
    const inside: LedgerLogPoint[] = []; let metres = 0, metreKnown = true;
    points.forEach((p, i) => { const t = ms(p.timestampIso); if (t > from && t <= to && !claimed.has(i)) { claimed.add(i); inside.push(p); if (p.sourceDistanceRaw === null) metreKnown = false; else metres += p.sourceDistanceRaw; } });
    let gapsInside = 0; for (let i = 1; i < inside.length; i++) if (ms(inside[i].timestampIso) - ms(inside[i - 1].timestampIso) > LOG_GAP_MS) gapsInside++;
    const kind: JourneyKind = !s.end ? "open_final" : s.km > 0 ? "moving" : "stopped";
    const touching = input.gpsIntervals.filter(g => ms(g.end) > from && ms(g.start) < to);
    const verifiedGpsKm = s.end && touching.length > 0 && touching.every(g => g.km !== null && ms(g.start) >= from && ms(g.end) <= to) ? km2(touching.reduce((n, g) => n + cents(g.km!), 0)) : null;
    const issues: JourneyIssue[] = [];
    if (overlapping.has(s.id)) issues.push("overlaps_another_segment");
    if (!s.end && s.km > 0) issues.push("open_segment_with_distance");
    if (kind === "moving" && input.logAvailable && inside.length === 0) issues.push("no_log_observations");
    if (gapsInside > 0) issues.push("log_gap_inside");
    const engineKnown = inside.filter(p => p.engineOn !== null);
    return {
      id: `J${String(index + 1).padStart(2, "0")}`, segmentId: s.id, kind, start: s.start, end: s.end,
      minutes: s.end ? Math.round((ms(s.end) - from) / 60_000) : null, providerKm: s.km,
      observations: inside.length, movingObservations: inside.filter(p => (p.speedKph ?? 0) > 0).length,
      engineOnObservations: engineKnown.length ? engineKnown.filter(p => p.engineOn).length : null,
      reportedTrailKm: input.logAvailable && inside.length > 0 && metreKnown ? Math.round(metres / 10) / 100 : null,
      verifiedGpsKm, positionSource: positionSource(inside), gapsInside, issues,
      ambiguous: issues.includes("overlaps_another_segment") || issues.includes("open_segment_with_distance")
    };
  });
  // Missing = no log records at all (unobservable). Periods outside report segments are separate: the log usually keeps
  // recording there (parked), so they are checked for log distance instead of being called missing.
  const missing: MissingInterval[] = [];
  const dayStart = Date.parse(`${input.day}T00:00:00+07:00`), dayEnd = dayStart + 86_400_000;
  const push = (a: number, b: number, source: MissingInterval["source"]) => { if (b - a > MISSING_HISTORY_MS) missing.push({ start: new Date(a).toISOString(), end: new Date(b).toISOString(), minutes: Math.round((b - a) / 60_000), source }); };
  if (input.logAvailable && points.length) {
    push(dayStart, ms(points[0].timestampIso), "before_first_record");
    for (let i = 1; i < points.length; i++) push(ms(points[i - 1].timestampIso), ms(points[i].timestampIso), "log_gap");
    push(ms(points.at(-1)!.timestampIso), Math.min(dayEnd, Date.now()), "after_last_record");
  } else if (!input.logAvailable) missing.push({ start: new Date(dayStart).toISOString(), end: new Date(Math.min(dayEnd, Date.now())).toISOString(), minutes: Math.round((Math.min(dayEnd, Date.now()) - dayStart) / 60_000), source: "log_gap" });
  const outside: OutsideReportInterval[] = [];
  const pushOutside = (a: number, b: number) => {
    if (b <= a) return;
    const inGap = points.filter((p, i) => !claimed.has(i) && ms(p.timestampIso) > a && ms(p.timestampIso) <= b);
    const metres = inGap.reduce((n, p) => n + (p.sourceDistanceRaw ?? 0), 0);
    outside.push({ start: new Date(a).toISOString(), end: new Date(b).toISOString(), minutes: Math.round((b - a) / 60_000), observations: inGap.length, logKm: input.logAvailable && inGap.length ? Math.round(metres / 10) / 100 : null });
  };
  let previousEnd: number | null = dayStart;
  for (const s of ordered) { if (previousEnd !== null && ms(s.start) > previousEnd) pushOutside(previousEnd, ms(s.start)); previousEnd = s.end ? Math.max(previousEnd ?? 0, ms(s.end)) : null; }
  if (previousEnd !== null && ordered.length) pushOutside(previousEnd, Math.min(dayEnd, Date.now()));
  const moving = journeys.filter(j => j.kind === "moving");
  const outsideKm = outside.reduce((n, o) => n + cents(o.logKm ?? 0), 0);
  return {
    version: "v4.4", journeys, missing, outsideReport: outside,
    totals: {
      outsideReportMinutes: outside.reduce((n, o) => n + o.minutes, 0), outsideReportLogKm: input.logAvailable ? km2(outsideKm) : null,
      cadenceJitterGaps: points.slice(1).filter((p, i) => { const d = ms(p.timestampIso) - ms(points[i].timestampIso); return d > LOG_GAP_MS && d <= MISSING_HISTORY_MS; }).length,
      providerKm: km2(journeys.reduce((n, j) => n + cents(j.providerKm), 0)), movingJourneys: moving.length,
      stops: journeys.filter(j => j.kind === "stopped").length, openFinal: journeys.filter(j => j.kind === "open_final").length,
      ambiguousJourneys: journeys.filter(j => j.ambiguous).length,
      reportedTrailKm: input.logAvailable && points.length && points.every(p => p.sourceDistanceRaw !== null) ? Math.round(points.reduce((n, p) => n + p.sourceDistanceRaw!, 0) / 10) / 100 : null,
      verifiedGpsKm: moving.length && moving.every(j => j.verifiedGpsKm !== null) ? km2(moving.reduce((n, j) => n + cents(j.verifiedGpsKm!), 0)) : null,
      observations: points.length, duplicateObservations: duplicates,
      positionSource: positionSource(points), missingMinutes: missing.reduce((n, m) => n + m.minutes, 0)
    }
  };
}

/* ---------------------------------------------------------------- Booking Diary matching per journey */

export type LedgerJob = { jobId: string; workOrder: string | null; pickupTime: string | null; bookingAssignment: "stable_vehicle_id" | "registration_only" };
export type JobMatchStatus = "confirmed" | "candidate" | "needs_review" | "no_journey";
export type JobMatchReason = "stable_vehicle_assignment" | "registration_only_assignment" | "same_booking_date" | "pickup_inside_journey" | "pickup_up_to_60_min_before_journey" | "work_order_reference" | "no_pickup_time" | "shares_pickup_time_with_another_job" | "matches_multiple_journeys" | "journey_shared_with_other_jobs" | "journey_ambiguous" | "conflicting_confirmations" | "confirmation_on_unsupported_journey" | "location_not_compared_positions_unverified" | "driver_not_confirmed";
export type JourneyJobMatch = { jobId: string; workOrder: string | null; pickupTime: string | null; status: JobMatchStatus; journeyIds: string[]; reasons: JobMatchReason[] };
export type JourneyMatchResult = { bookingSource: "unavailable" | "none_found" | "found"; jobs: JourneyJobMatch[]; jobsByJourney: Record<string, string[]> };

/**
 * Ranks each booking against moving journeys by its scheduled pickup instant: inside the journey, or up to 60 minutes
 * before it (loading before departure). Never confirms. A missing booking source and "no bookings" stay distinct.
 */
export function matchJourneysToBookings(day: string, ledger: JourneyLedger | null, jobs: readonly LedgerJob[] | null, confirmed?: readonly { jobId: string; journeyId: string }[]): JourneyMatchResult {
  if (jobs === null) return { bookingSource: "unavailable", jobs: [], jobsByJourney: {} };
  if (jobs.length === 0) return { bookingSource: "none_found", jobs: [], jobsByJourney: {} };
  const moving = ledger?.journeys.filter(j => j.kind === "moving") ?? [];
  const pickupMs = (t: string | null) => t && /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(t) ? Date.parse(`${day}T${t.length === 5 ? `${t}:00` : t}+07:00`) : Number.NaN;
  // A job confirmed to two different journeys, or to a journey that is not a supported moving one, is a conflict: it is not
  // counted as confirmed and goes to review. A journey that was confirmed for several jobs (multi-stop) is fine.
  const confirmedBy = new Map<string, string>(); const conflictingJobs = new Set<string>(); const unsupported = new Set<string>();
  for (const c of confirmed ?? []) {
    if (confirmedBy.has(c.jobId) && confirmedBy.get(c.jobId) !== c.journeyId) conflictingJobs.add(c.jobId);
    confirmedBy.set(c.jobId, c.journeyId);
    const j = moving.find(m => m.id === c.journeyId); if (!j || j.ambiguous) unsupported.add(c.jobId);
  }
  const draft = jobs.map(job => {
    const at = pickupMs(job.pickupTime);
    const reasons: JobMatchReason[] = [job.bookingAssignment === "stable_vehicle_id" ? "stable_vehicle_assignment" : "registration_only_assignment", "same_booking_date"];
    if (job.workOrder) reasons.push("work_order_reference");
    let journeyIds: string[] = [];
    if (!Number.isFinite(at)) reasons.push("no_pickup_time");
    else {
      const inside = moving.filter(j => ms(j.start) <= at && at <= ms(j.end));
      const before = inside.length ? [] : moving.filter(j => ms(j.start) > at && ms(j.start) - at <= PICKUP_LEAD_MS).slice(0, 1);
      journeyIds = [...inside, ...before].map(j => j.id);
      if (inside.length) reasons.push("pickup_inside_journey"); else if (before.length) reasons.push("pickup_up_to_60_min_before_journey");
      if (inside.length > 1) reasons.push("matches_multiple_journeys");
    }
    const c = conflictingJobs.has(job.jobId) || unsupported.has(job.jobId) ? undefined : confirmedBy.get(job.jobId);
    if (conflictingJobs.has(job.jobId)) reasons.push("conflicting_confirmations");
    if (unsupported.has(job.jobId)) reasons.push("confirmation_on_unsupported_journey");
    if (c && moving.some(j => j.id === c)) journeyIds = [c];
    if (ledger && ledger.totals.positionSource !== "gps") reasons.push("location_not_compared_positions_unverified");
    reasons.push("driver_not_confirmed");
    return { job, journeyIds, reasons, confirmed: Boolean(c && journeyIds[0] === c), conflict: conflictingJobs.has(job.jobId) || unsupported.has(job.jobId) };
  });
  const jobsByJourney: Record<string, string[]> = {};
  for (const d of draft) for (const id of d.journeyIds) (jobsByJourney[id] ??= []).push(d.job.jobId);
  const result: JourneyJobMatch[] = draft.map(d => {
    const shareTime = Number.isFinite(pickupMs(d.job.pickupTime)) && draft.some(o => o !== d && o.job.pickupTime === d.job.pickupTime);
    if (shareTime) d.reasons.push("shares_pickup_time_with_another_job");
    if (d.journeyIds.some(id => (jobsByJourney[id]?.length ?? 0) > 1)) d.reasons.push("journey_shared_with_other_jobs");
    const ambiguous = d.journeyIds.some(id => moving.find(j => j.id === id)?.ambiguous);
    if (ambiguous) d.reasons.push("journey_ambiguous");
    const status: JobMatchStatus = d.confirmed ? "confirmed" : d.conflict ? "needs_review" : d.journeyIds.length === 0 ? "no_journey" : shareTime || ambiguous || d.reasons.includes("matches_multiple_journeys") ? "needs_review" : "candidate";
    return { jobId: d.job.jobId, workOrder: d.job.workOrder, pickupTime: d.job.pickupTime, status, journeyIds: d.journeyIds, reasons: d.reasons };
  });
  return { bookingSource: "found", jobs: result, jobsByJourney };
}

/* ---------------------------------------------------------------- Source-aware distance allocation */

export type AllocationCategory = "confirmed_job" | "supported_repositioning" | "candidate_awaiting_confirmation" | "unallocated_unresolved";
export type ReconciliationStatus = "complete_verified" | "partially_allocated" | "awaiting_office_review" | "conflicting_evidence" | "source_incomplete" | "unknown";
export type ReconciliationReason = "provider_day_not_read" | "provider_totals_not_reconciled" | "provider_coverage_unverified" | "log_history_missing" | "ambiguous_journeys" | "job_conflicts" | "category_sum_mismatch" | "candidates_awaiting_review" | "no_confirmation_source" | "unallocated_km_remain" | "positions_not_verified_gps";
export type DistanceAllocation = {
  reconciliation: { status: ReconciliationStatus; reasons: ReconciliationReason[]; /** Only set when status is complete_verified. Never a forced total. */ reconciledTotalKm: number | null; gpsVerified: boolean };
  providerKm: number | null;
  coverage: "not_read" | "not_reconciled" | "reconciled_coverage_unverified" | "reconciled_complete";
  confirmedJobKm: number | null;
  confirmationSource: "not_available" | "approved_store";
  supportedRepositioningKm: null;
  repositioningReason: "no_operational_evidence";
  candidateKm: number | null;
  unallocatedKm: number | null;
  ambiguousKm: number | null;
  missing: { intervals: number; minutes: number; km: null };
  perJourney: { journeyId: string; km: number; category: AllocationCategory; jobIds: string[] }[];
  sumMatchesProvider: boolean | null;
};

/**
 * Each moving journey's provider km goes to exactly one category, so a kilometre is never allocated twice, even when
 * several bookings share a journey. Ambiguous journeys always stay unresolved. Missing intervals have unknown km.
 */
type AllocationInput = { ledger: JourneyLedger | null; matches: JourneyMatchResult; providerReconciled: boolean; providerComplete: boolean; providerTotalKm: number | null };
function allocateCore(input: AllocationInput): Omit<DistanceAllocation, "reconciliation"> {
  const { ledger, matches } = input;
  const coverage: DistanceAllocation["coverage"] = !ledger ? "not_read" : !input.providerReconciled || input.providerTotalKm === null ? "not_reconciled" : input.providerComplete ? "reconciled_complete" : "reconciled_coverage_unverified";
  const base = { supportedRepositioningKm: null, repositioningReason: "no_operational_evidence" as const, missing: { intervals: ledger?.missing.length ?? 0, minutes: ledger?.totals.missingMinutes ?? 0, km: null } };
  const anyConfirmed = matches.jobs.some(j => j.status === "confirmed");
  if (!ledger || coverage === "not_read" || coverage === "not_reconciled") return { ...base, providerKm: null, coverage, confirmedJobKm: null, confirmationSource: anyConfirmed ? "approved_store" : "not_available", candidateKm: null, unallocatedKm: null, ambiguousKm: null, perJourney: [], sumMatchesProvider: null };
  const perJourney: DistanceAllocation["perJourney"] = [];
  const sums: Record<AllocationCategory, number> = { confirmed_job: 0, supported_repositioning: 0, candidate_awaiting_confirmation: 0, unallocated_unresolved: 0 };
  let ambiguous = 0;
  for (const j of ledger.journeys) {
    if (j.kind === "stopped" || (j.kind === "open_final" && j.providerKm === 0)) continue;
    const jobIds = matches.jobsByJourney[j.id] ?? [];
    const linked = matches.jobs.filter(m => jobIds.includes(m.jobId));
    const category: AllocationCategory = j.ambiguous ? "unallocated_unresolved" : linked.some(m => m.status === "confirmed") ? "confirmed_job" : linked.some(m => m.status === "candidate" || m.status === "needs_review") ? "candidate_awaiting_confirmation" : "unallocated_unresolved";
    if (j.ambiguous) ambiguous += cents(j.providerKm);
    sums[category] += cents(j.providerKm);
    perJourney.push({ journeyId: j.id, km: j.providerKm, category, jobIds });
  }
  const allocated = sums.confirmed_job + sums.candidate_awaiting_confirmation + sums.unallocated_unresolved;
  return {
    ...base, providerKm: input.providerTotalKm, coverage,
    confirmedJobKm: anyConfirmed ? km2(sums.confirmed_job) : null, confirmationSource: anyConfirmed ? "approved_store" : "not_available",
    candidateKm: km2(sums.candidate_awaiting_confirmation), unallocatedKm: km2(sums.unallocated_unresolved), ambiguousKm: km2(ambiguous),
    perJourney, sumMatchesProvider: allocated === cents(input.providerTotalKm!)
  };
}

/**
 * Allocation with an explicit reconciliation status. A reconciled total exists only when provider coverage is complete,
 * no history is missing, no journey is ambiguous, nothing conflicts, and every moving km is confirmed from an approved record.
 * Otherwise the status says what is wrong and no total is forced.
 */
export function allocateJourneyDistance(input: AllocationInput): DistanceAllocation {
  const core = allocateCore(input);
  const reasons: ReconciliationReason[] = [];
  const add = (r: ReconciliationReason) => { if (!reasons.includes(r)) reasons.push(r); };
  const jobConflicts = input.matches.jobs.some(j => j.status === "needs_review" && j.reasons.some(r => r === "shares_pickup_time_with_another_job" || r === "matches_multiple_journeys" || r === "conflicting_confirmations" || r === "confirmation_on_unsupported_journey"));
  let status: ReconciliationStatus;
  if (core.coverage === "not_read") { add("provider_day_not_read"); status = "unknown"; }
  else if (core.coverage === "not_reconciled") { add("provider_totals_not_reconciled"); status = "source_incomplete"; }
  else {
    if (core.coverage !== "reconciled_complete") add("provider_coverage_unverified");
    if (input.ledger && (!input.ledger.totals.observations || input.ledger.missing.length > 0)) add("log_history_missing");
    if ((core.ambiguousKm ?? 0) > 0 || (input.ledger?.totals.ambiguousJourneys ?? 0) > 0) add("ambiguous_journeys");
    if (jobConflicts) add("job_conflicts");
    if (core.sumMatchesProvider === false) add("category_sum_mismatch");
    if ((core.candidateKm ?? 0) > 0) add("candidates_awaiting_review");
    if (core.confirmationSource === "not_available") add("no_confirmation_source");
    if ((core.unallocatedKm ?? 0) > 0) add("unallocated_km_remain");
    if (input.ledger && input.ledger.totals.positionSource !== "gps") add("positions_not_verified_gps");
    const sourceProblems = reasons.some(r => r === "provider_coverage_unverified" || r === "log_history_missing");
    const confirmed = core.confirmedJobKm ?? 0;
    if (reasons.includes("job_conflicts") || reasons.includes("ambiguous_journeys") || reasons.includes("category_sum_mismatch")) status = "conflicting_evidence";
    else if (sourceProblems) status = "source_incomplete";
    else if ((core.candidateKm ?? 0) > 0) status = "awaiting_office_review";
    else if (confirmed > 0 && (core.unallocatedKm ?? 0) > 0) status = "partially_allocated";
    else if (confirmed > 0 && (core.unallocatedKm ?? 0) === 0) status = "complete_verified";
    // Complete coverage but no candidates and no confirmed km: nothing has been allocated, so no allocation status can be claimed.
    else status = "unknown";
  }
  const reconciledTotalKm = status === "complete_verified" ? core.confirmedJobKm : null;
  return { ...core, reconciliation: { status, reasons, reconciledTotalKm, gpsVerified: status === "complete_verified" && input.ledger?.totals.positionSource === "gps" } };
}

/* ---------------------------------------------------------------- Temporary office decisions (never saved) */

export type OfficeDecision = "confirm" | "reject" | "needs_review";
export type TemporaryDecisionState = { saved: false; storage: "in_memory_component_state"; decisions: Record<string, OfficeDecision> };
export function temporaryDecisionState(decisions: Record<string, OfficeDecision | undefined>): TemporaryDecisionState {
  const clean: Record<string, OfficeDecision> = {};
  for (const [id, d] of Object.entries(decisions)) if (d === "confirm" || d === "reject" || d === "needs_review") clean[id] = d;
  return { saved: false, storage: "in_memory_component_state", decisions: clean };
}

/* ---------------------------------------------------------------- Fleet totals */

/** Fleet totals over vehicle-days: unique vehicle-days only, Unknown never counted as zero, partial sums labelled partial. */
export function summarizeFleetAllocation(rows: readonly { vehicleId: string; registration: string; day: string; allocation: DistanceAllocation | null }[]) {
  const keys = new Set<string>(); const duplicates: string[] = []; const unique: typeof rows[number][] = [];
  for (const r of rows) { const k = `${r.vehicleId}|${r.day}`; if (keys.has(k)) { duplicates.push(k); continue; } keys.add(k); unique.push(r); }
  const read = unique.filter(r => r.allocation && r.allocation.providerKm !== null);
  const sum = (pick: (a: DistanceAllocation) => number | null) => { const vals = read.map(r => pick(r.allocation!)); return vals.length && vals.every(v => v !== null) ? km2(vals.reduce((n: number, v) => n + cents(v!), 0)) : null; };
  return {
    vehicleDays: unique.length, contributingVehicleDays: read.length, unknownVehicleDays: unique.length - read.length, duplicatesIgnored: duplicates.length,
    providerKmPartial: sum(a => a.providerKm), candidateKmPartial: sum(a => a.candidateKm), unallocatedKmPartial: sum(a => a.unallocatedKm),
    complete: unique.length > 0 && read.length === unique.length && read.every(r => r.allocation!.coverage === "reconciled_complete")
  };
}
