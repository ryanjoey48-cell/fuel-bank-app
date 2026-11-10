/**
 * V4.5 practical vehicle-day summary. Pure and read-only. Every figure carries the source it came from, and a figure
 * that cannot be supported is null (shown as an em dash), never zero. Nothing here is saved.
 */
import { allocateJourneyDistance, matchJourneysToBookings, type DistanceAllocation, type JourneyJobMatch, type JourneyLedger, type JourneyMatchResult, type LedgerJob } from "./fleet-journey-ledger";

export type Provenance =
  | "forth_parking_report" | "forth_log_distance" | "forth_log_position_source" | "forth_report_segments"
  | "booking_diary" | "approved_confirmation_record" | "ees_derived" | "fuel_logs_purchase" | "fuel_log_odometer" | "weekly_mileage_odometer" | "source_comparison";

export type DayAnalysisInput = {
  day: string;
  journeyLedger: JourneyLedger | null;
  providerReconciled: boolean;
  providerComplete: boolean;
  providerKm: number | null;
  jobs: readonly LedgerJob[] | null;
  /** Approved, persisted confirmations. Always undefined today: no such store exists. */
  confirmed?: readonly { jobId: string; journeyId: string }[];
};
export type DayAnalysis = { matches: JourneyMatchResult; allocation: DistanceAllocation };

/** The one place journey matching and allocation are combined, so every view shows the same answer. */
export function analyseDay(input: DayAnalysisInput): DayAnalysis {
  const matches = matchJourneysToBookings(input.day, input.journeyLedger, input.jobs === null ? null : [...input.jobs], input.confirmed);
  const allocation = allocateJourneyDistance({ ledger: input.journeyLedger, matches, providerReconciled: input.providerReconciled, providerComplete: input.providerComplete, providerTotalKm: input.providerReconciled ? input.providerKm : null });
  return { matches, allocation };
}

export type SummaryIssue =
  | "provider_day_not_read" | "provider_totals_not_reconciled" | "open_final_segment_coverage_unverified" | "positions_not_verified_gps"
  | "job_matches_need_office_review" | "no_booking_found_not_proof_of_no_work" | "booking_source_unavailable" | "journey_detail_restricted"
  | "log_distance_outside_report_segments" | "provider_trail_difference" | "odometer_source_disagrees" | "odometer_repeated_reading" | "odometer_unknown_interval"
  | "fuel_purchase_not_consumption";

export type DaySummary = {
  day: string;
  reportedKm: { value: number | null; source: Provenance };
  reportJourneys: { moving: number | null; stops: number | null; openFinal: number | null; source: Provenance };
  trailKm: { value: number | null; source: Provenance; differenceKm: number | null; differencePct: number | null };
  positionConfidence: { positionSource: "gps" | "no_gps" | "mixed" | "none" | "unknown"; observations: number | null; verifiedObservations: number | null; source: Provenance };
  jobs: { source: Provenance; found: "unavailable" | "none_found" | "found"; candidate: number; needsReview: number; unplaced: number; confirmed: number };
  confirmedKm: { value: number | null; source: Provenance; reason: "approved_record" | "no_approved_confirmation_record" | "not_reconciled" };
  candidateKm: number | null;
  unallocatedKm: number | null;
  completeness: { status: DistanceAllocation["reconciliation"]["status"]; reasons: DistanceAllocation["reconciliation"]["reasons"]; coverage: DistanceAllocation["coverage"]; missingMinutes: number | null };
  fuel: { records: number | null; litres: number | null; costThb: number | null; note: "purchased_not_consumed"; source: Provenance };
  odometer: { fuelLogs: { id: string; km: number | null }[] | null; weekly: { id: string; km: number | null; baseline: boolean | null }[] | null; repeatedReadings: boolean; unknownIntervals: boolean; source: Provenance[] };
  discrepancies: { pair: string; status: string; differenceKm: number | null }[];
  issues: SummaryIssue[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export function buildVehicleDaySummary(input: {
  day: string;
  providerRead: boolean;
  journeyLedger: JourneyLedger | null;
  journeysRestricted: boolean;
  analysis: DayAnalysis;
  providerKm: number | null;
  providerReconciled: boolean;
  gpsObservations: number | null;
  gpsVerifiedObservations: number | null;
  fuel: { records: number; litres: number | null; costThb: number | null } | null;
  fuelOdometer: { id: string; km: number | null }[] | null;
  weeklyOdometer: { id: string; km: number | null; baseline: boolean | null }[] | null;
  comparisons: { pair: string; status: string; differenceKm: number | null }[];
}): DaySummary {
  const { analysis, journeyLedger: L } = input;
  const a = analysis.allocation;
  const issues: SummaryIssue[] = [];
  const add = (i: SummaryIssue) => { if (!issues.includes(i)) issues.push(i); };
  if (!input.providerRead) add("provider_day_not_read");
  else if (!input.providerReconciled) add("provider_totals_not_reconciled");
  else if (a.coverage !== "reconciled_complete") add("open_final_segment_coverage_unverified");
  if (input.journeysRestricted) add("journey_detail_restricted");
  if (L && L.totals.positionSource !== "gps") add("positions_not_verified_gps");
  if (analysis.matches.bookingSource === "none_found") add("no_booking_found_not_proof_of_no_work");
  if (analysis.matches.bookingSource === "unavailable") add("booking_source_unavailable");
  if (analysis.matches.jobs.some(j => j.status === "needs_review" || j.status === "no_journey")) add("job_matches_need_office_review");
  if (L && (L.totals.outsideReportLogKm ?? 0) > 0) add("log_distance_outside_report_segments");
  const trail = L?.totals.reportedTrailKm ?? null;
  const diff = trail !== null && input.providerKm !== null && input.providerReconciled ? r2(trail - input.providerKm) : null;
  const diffPct = diff !== null && input.providerKm ? r2((diff / input.providerKm) * 100) : null;
  if (diffPct !== null && Math.abs(diffPct) > 1) add("provider_trail_difference");
  if (input.comparisons.some(c => c.status === "review_required")) add("odometer_source_disagrees");
  const fuelKms = (input.fuelOdometer ?? []).map(c => c.km).filter((k): k is number => k !== null);
  const repeated = fuelKms.length > 1 && new Set(fuelKms).size < fuelKms.length;
  if (repeated) add("odometer_repeated_reading");
  const unknownInterval = (input.weeklyOdometer ?? []).some(c => c.baseline === null) || ((input.fuelOdometer?.length ?? 0) === 1 && (input.weeklyOdometer?.length ?? 0) === 0);
  if (unknownInterval) add("odometer_unknown_interval");
  if (input.fuel && input.fuel.records > 0) add("fuel_purchase_not_consumption");
  const j = analysis.matches.jobs;
  return {
    day: input.day,
    reportedKm: { value: input.providerRead && input.providerReconciled ? input.providerKm : null, source: "forth_parking_report" },
    reportJourneys: { moving: L?.totals.movingJourneys ?? null, stops: L?.totals.stops ?? null, openFinal: L?.totals.openFinal ?? null, source: "forth_report_segments" },
    trailKm: { value: trail, source: "forth_log_distance", differenceKm: diff, differencePct: diffPct },
    positionConfidence: { positionSource: L ? L.totals.positionSource : "unknown", observations: input.gpsObservations, verifiedObservations: input.gpsVerifiedObservations, source: "forth_log_position_source" },
    jobs: { source: "booking_diary", found: analysis.matches.bookingSource, candidate: j.filter((x: JourneyJobMatch) => x.status === "candidate").length, needsReview: j.filter(x => x.status === "needs_review").length, unplaced: j.filter(x => x.status === "no_journey").length, confirmed: j.filter(x => x.status === "confirmed").length },
    confirmedKm: { value: a.confirmedJobKm, source: a.confirmedJobKm === null ? "ees_derived" : "approved_confirmation_record", reason: a.confirmedJobKm !== null ? "approved_record" : a.coverage === "not_reconciled" || a.coverage === "not_read" ? "not_reconciled" : "no_approved_confirmation_record" },
    candidateKm: a.candidateKm, unallocatedKm: a.unallocatedKm,
    completeness: { status: a.reconciliation.status, reasons: a.reconciliation.reasons, coverage: a.coverage, missingMinutes: L ? L.totals.missingMinutes : null },
    fuel: { records: input.fuel?.records ?? null, litres: input.fuel?.litres ?? null, costThb: input.fuel?.costThb ?? null, note: "purchased_not_consumed", source: "fuel_logs_purchase" },
    odometer: { fuelLogs: input.fuelOdometer, weekly: input.weeklyOdometer, repeatedReadings: repeated, unknownIntervals: unknownInterval, source: ["fuel_log_odometer", "weekly_mileage_odometer"] },
    discrepancies: input.comparisons, issues
  };
}
